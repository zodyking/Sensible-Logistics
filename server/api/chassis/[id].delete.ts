import { and, eq, inArray } from 'drizzle-orm'
import { chassis, containers, trips } from '../../database/schema'
import { LIVE_TRIP_STATUSES } from '../../services/movements'
import { assertTenant, requireAuth } from '../../utils/session'

/** Soft-delete a chassis. Open trips must be finished or cancelled first. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Chassis id is required.' })
  }

  const db = useDb()
  const [record] = await db.select().from(chassis).where(eq(chassis.id, id)).limit(1)
  assertTenant(auth, record, 'Chassis')
  if (record!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Chassis not found.' })
  }

  const [live] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(
      eq(trips.companyId, auth.companyId),
      eq(trips.chassisId, id),
      inArray(trips.status, [...LIVE_TRIP_STATUSES]),
    ))
    .limit(1)

  if (live) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Finish or cancel the active trip before deleting this chassis.',
    })
  }

  const now = new Date()
  await db
    .update(containers)
    .set({ currentChassisId: null, updatedAt: now })
    .where(and(eq(containers.companyId, auth.companyId), eq(containers.currentChassisId, id)))

  await db
    .update(chassis)
    .set({
      deletedAt: now,
      currentContainerId: null,
      currentLocationId: null,
      status: 'AVAILABLE',
      updatedAt: now,
    })
    .where(eq(chassis.id, id))

  return { ok: true }
})
