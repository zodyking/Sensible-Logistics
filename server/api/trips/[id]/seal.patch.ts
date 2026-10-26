import { z } from 'zod'
import { correctTripSeal } from '../../../services/movements'
import { requireDriver } from '../../../utils/session'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  sealNumber: z.string().trim().max(60),
})

/** Correct the seal on a live loaded trip without leaving the dashboard card. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const tripId = getRouterParam(event, 'id')
  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'Movement id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  return correctTripSeal(useDb(), auth, { ...body, tripId })
})
