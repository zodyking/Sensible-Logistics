import { z } from 'zod'
import { cancelPickup } from '../../../services/movements'
import { syncTodayTimeCardQuietly } from '../../../services/time-cards'
import { requireDriver } from '../../../utils/session'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  reason: z.string().trim().max(500).nullish(),
})

/** Cancel a live movement and return the driver to no active trip. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const tripId = getRouterParam(event, 'id')

  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'Movement id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  const db = useDb()
  const result = await cancelPickup(db, auth, { ...body, tripId })
  await syncTodayTimeCardQuietly(db, auth)
  return result
})
