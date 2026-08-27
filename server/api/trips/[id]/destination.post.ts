import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { locations, trips } from '../../../database/schema'
import { assertTenant, requireDriver } from '../../../utils/session'

const schema = z.object({
  destinationLocationId: z.string().uuid('Choose a drop-off location.'),
})

const LIVE: Array<typeof trips.$inferSelect['status']> = [
  'PICKUP_IN_PROGRESS',
  'IN_TRANSIT',
  'DROPOFF_IN_PROGRESS',
]

/** Set or change the intended drop-off before arrival. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const tripId = getRouterParam(event, 'id')

  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'Movement id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  const db = useDb()

  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1)
  assertTenant(auth, trip, 'Movement')

  if (trip!.driverId !== auth.driverId) {
    throw createError({ statusCode: 403, statusMessage: 'This movement belongs to another driver.' })
  }

  if (!LIVE.includes(trip!.status)) {
    throw createError({ statusCode: 409, statusMessage: 'Drop-off can only be changed on a live movement.' })
  }

  const [location] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.id, body.destinationLocationId), eq(locations.companyId, auth.companyId)))
    .limit(1)

  if (!location) {
    throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
  }

  const [updated] = await db
    .update(trips)
    .set({ destinationLocationId: location.id, updatedAt: new Date() })
    .where(eq(trips.id, tripId))
    .returning()

  return { trip: updated }
})
