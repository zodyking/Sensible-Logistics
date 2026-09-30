import { and, eq, inArray, sql } from 'drizzle-orm'
import { chassis, containerPlacements, containers, trips } from '../database/schema'
import type { Database, DbExecutor } from '../utils/db'
import type { AuthContext } from '../utils/session'
import { assertTenant } from '../utils/session'
import { TRIP_STATUSES } from '#shared/utils/domain'

const OPEN_TRIP_STATUSES = TRIP_STATUSES.filter(status => status !== 'COMPLETED' && status !== 'CANCELLED')

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

  const [openTrip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(
      eq(trips.companyId, auth.companyId),
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
