import { and, eq, inArray } from 'drizzle-orm'
import { chassis, containers, locations, trips } from '../database/schema'
import type { Database } from '../utils/db'
import type { AuthContext } from '../utils/session'
import { assertTenant } from '../utils/session'
import { LIVE_TRIP_STATUSES } from './movements'
import { addChassisAtLocation } from './placements'
import { ensureUncategorizedLocation } from './locations'
import type { RetireEquipmentResult } from './container-delete'

async function assertNoLiveTrip(db: Database, companyId: string, chassisId: string) {
  const [live] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(
      eq(trips.companyId, companyId),
      eq(trips.chassisId, chassisId),
      inArray(trips.status, [...LIVE_TRIP_STATUSES]),
    ))
    .limit(1)

  if (live) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Finish or cancel the active trip before deleting this chassis.',
    })
  }
}

/** Soft-delete a chassis. Open trips must be finished or cancelled first. */
export async function softDeleteChassis(
  db: Database,
  auth: AuthContext,
  chassisId: string,
) {
  const [record] = await db.select().from(chassis).where(eq(chassis.id, chassisId)).limit(1)
  assertTenant(auth, record, 'Chassis')
  if (record!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Chassis not found.' })
  }

  await assertNoLiveTrip(db, auth.companyId, chassisId)

  const now = new Date()
  await db
    .update(containers)
    .set({ currentChassisId: null, updatedAt: now })
    .where(and(eq(containers.companyId, auth.companyId), eq(containers.currentChassisId, chassisId)))

  await db
    .update(chassis)
    .set({
      deletedAt: now,
      currentContainerId: null,
      currentLocationId: null,
      status: 'AVAILABLE',
      updatedAt: now,
    })
    .where(eq(chassis.id, chassisId))

  return { ok: true as const }
}

/**
 * Delete means Uncategorized everywhere except Uncategorized itself,
 * where the chassis actually leaves the pool.
 */
export async function retireChassis(
  db: Database,
  auth: AuthContext,
  chassisId: string,
): Promise<RetireEquipmentResult> {
  const [record] = await db.select().from(chassis).where(eq(chassis.id, chassisId)).limit(1)
  assertTenant(auth, record, 'Chassis')
  if (record!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Chassis not found.' })
  }

  await assertNoLiveTrip(db, auth.companyId, chassisId)

  const [site] = record!.currentLocationId
    ? await db.select().from(locations).where(eq(locations.id, record!.currentLocationId)).limit(1)
    : []

  if (site?.isUncategorized) {
    await softDeleteChassis(db, auth, chassisId)
    return { ok: true, outcome: 'deleted' }
  }

  const hold = await ensureUncategorizedLocation(db, auth.companyId)
  const now = new Date()
  await db
    .update(containers)
    .set({ currentChassisId: null, updatedAt: now })
    .where(and(eq(containers.companyId, auth.companyId), eq(containers.currentChassisId, chassisId)))
  await db
    .update(chassis)
    .set({ currentContainerId: null, updatedAt: now })
    .where(eq(chassis.id, chassisId))

  await addChassisAtLocation(db, auth, {
    eventId: crypto.randomUUID(),
    locationId: hold.id,
    chassisNumber: record!.number,
  })

  return { ok: true, outcome: 'moved', uncategorizedLocationId: hold.id }
}
