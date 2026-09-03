import { and, eq } from 'drizzle-orm'
import { trips } from '../../database/schema'
import { discardFinishedTrip } from '../../services/movements'
import { assertTenant, requireAuth } from '../../utils/session'
import { isLiveTripStatus } from '#shared/utils/domain'

/** Permanently remove a finished trip from history. Live trips must be cancelled. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const tripId = getRouterParam(event, 'id')
  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'Trip id is required.' })
  }

  const db = useDb()
  const [trip] = await db
    .select({
      id: trips.id,
      companyId: trips.companyId,
      driverId: trips.driverId,
      status: trips.status,
    })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.companyId, auth.companyId)))
    .limit(1)

  assertTenant(auth, trip, 'Trip')
  if (auth.role !== 'ADMIN' && trip!.driverId !== auth.driverId) {
    throw createError({ statusCode: 403, statusMessage: 'This movement belongs to another driver.' })
  }
  if (isLiveTripStatus(trip!.status)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Cancel the live trip first. Finished trips can be deleted from history.',
    })
  }

  await discardFinishedTrip(db, auth.companyId, tripId)
  return { ok: true }
})
