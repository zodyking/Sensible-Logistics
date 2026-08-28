import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { containers, locations, trips } from '../../database/schema'
import { LIVE_TRIP_STATUSES } from '../../services/movements'
import { assertTenant, requireAuth } from '../../utils/session'

/** Soft-delete a location so it no longer appears in pickup or drop-off. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }

  const db = useDb()
  const [location] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.id, id), isNull(locations.deletedAt)))
    .limit(1)
  assertTenant(auth, location, 'Location')

  const [onSite] = await db
    .select({ id: containers.id })
    .from(containers)
    .where(and(
      eq(containers.companyId, auth.companyId),
      eq(containers.currentLocationId, id),
      sql`${containers.activePoolState} <> 'INACTIVE'`,
    ))
    .limit(1)

  if (onSite) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This location still has containers on site. Move or drop them off first.',
    })
  }

  const [liveTrip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(
      eq(trips.companyId, auth.companyId),
      inArray(trips.status, [...LIVE_TRIP_STATUSES]),
      or(eq(trips.originLocationId, id), eq(trips.destinationLocationId, id)),
    ))
    .limit(1)

  if (liveTrip) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This location is used by an active trip. Finish or cancel that trip first.',
    })
  }

  const now = new Date()
  await db
    .update(locations)
    .set({
      deletedAt: now,
      status: 'ARCHIVED',
      updatedAt: now,
    })
    .where(eq(locations.id, id))

  return { ok: true as const }
})
