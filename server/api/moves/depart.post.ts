import { z } from 'zod'
import { departConnected } from '../../services/movements'
import { requireDriver } from '../../utils/session'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  destinationLocationId: z.string().uuid().nullish(),
  notes: z.string().trim().max(2000).nullish(),
  gps: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional(),
  }).nullish(),
})

/** Leave the current location with the hooked container — the live move starts. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const body = await readValidatedJson(event, schema)
  return departConnected(useDb(), auth, body)
})
