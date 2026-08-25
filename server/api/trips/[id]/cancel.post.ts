import { z } from 'zod'
import { cancelPickup } from '../../../services/movements'
import { requireDriver } from '../../../utils/session'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  reason: z.string().trim().max(500).nullish(),
})

/** Abandon an unconfirmed pickup and clear the temporary pool claim. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const tripId = getRouterParam(event, 'id')

  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'Movement id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  return cancelPickup(useDb(), auth, { ...body, tripId })
})
