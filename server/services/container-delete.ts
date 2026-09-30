import { and, eq, inArray, sql } from 'drizzle-orm'
import { chassis, containerPlacements, containers, locations, trips } from '../database/schema'
import type { Database, DbExecutor } from '../utils/db'
import type { AuthContext } from '../utils/session'
import { assertTenant } from '../utils/session'
import { TRIP_STATUSES } from '#shared/utils/domain'
import { addContainerAtLocation } from './placements'
import { ensureUncategorizedLocation } from './locations'

const OPEN_TRIP_STATUSES = TRIP_STATUSES.filter(status => status !== 'COMPLETED' && status !== 'CANCELLED')

export type RetireEquipmentResult = {
  ok: true
  outcome: 'moved' | 'deleted'
  uncategorizedLocationId?: string
}

async function assertNoOpenTrip(db: Database | DbExecutor, companyId: string, containerId: string) {
  const [openTrip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(
      eq(trips.companyId, companyId),
      eq(trips.containerId, containerId),
      inArray(trips.status, [...OPEN_TRIP_STATUSES]),
    ))
    .limit(1)

  if (openTrip) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Finish or cancel the active trip before deleting this container.',
    })
  }
}

/** Soft-delete a container. Open trips must be finished or cancelled first. */
export async function softDeleteContainer(
  db: Database | DbExecutor,
  auth: AuthContext,
  containerId: string,
) {
  const [container] = await db.select().from(containers).where(eq(containers.id, containerId)).limit(1)
  assertTenant(auth, container, 'Container')
  if (container!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Container not found.' })
  }

  await assertNoOpenTrip(db, auth.companyId, containerId)

  const now = new Date()
  await db
    .update(containers)
    .set({
      deletedAt: now,
      activePoolState: 'INACTIVE',
      currentDriverId: null,
      currentLocationId: null,
      activeMovementId: null,
      currentChassisId: null,
      updatedAt: now,
    })
    .where(eq(containers.id, containerId))

  await db
    .update(chassis)
    .set({ currentContainerId: null, updatedAt: now })
    .where(and(eq(chassis.companyId, auth.companyId), eq(chassis.currentContainerId, containerId)))

  await db
    .update(containerPlacements)
    .set({ supersededAt: now })
    .where(and(
      eq(containerPlacements.companyId, auth.companyId),
      eq(containerPlacements.containerId, containerId),
      sql`${containerPlacements.supersededAt} is null`,
    ))

  return { ok: true as const }
}

/**
 * Delete means Uncategorized everywhere except Uncategorized itself,
 * where the box actually leaves the pool.
 */
export async function retireContainer(
  db: Database,
  auth: AuthContext,
  containerId: string,
): Promise<RetireEquipmentResult> {
  const [container] = await db.select().from(containers).where(eq(containers.id, containerId)).limit(1)
  assertTenant(auth, container, 'Container')
  if (container!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Container not found.' })
  }

  await assertNoOpenTrip(db, auth.companyId, containerId)

  const [site] = container!.currentLocationId
    ? await db.select().from(locations).where(eq(locations.id, container!.currentLocationId)).limit(1)
    : []

  if (site?.isUncategorized) {
    await softDeleteContainer(db, auth, containerId)
    return { ok: true, outcome: 'deleted' }
  }

  const hold = await ensureUncategorizedLocation(db, auth.companyId)
  let chassisNumber: string | null = null
  if (container!.currentChassisId) {
    const [unit] = await db.select().from(chassis).where(eq(chassis.id, container!.currentChassisId)).limit(1)
    chassisNumber = unit?.number ?? null
  }

  await addContainerAtLocation(db, auth, {
    eventId: crypto.randomUUID(),
    locationId: hold.id,
    containerNumber: container!.number,
    containerType: container!.containerType,
    equipmentType: container!.equipmentType,
    isLoaded: container!.isLoaded,
    sealNumber: container!.sealNumber,
    chassisNumber,
  })

  return { ok: true, outcome: 'moved', uncategorizedLocationId: hold.id }
}
