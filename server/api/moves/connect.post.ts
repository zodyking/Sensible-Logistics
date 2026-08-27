import { z } from 'zod'
import { connectAtLocation } from '../../services/movements'
import { requireDriver } from '../../utils/session'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  containerId: z.string().uuid('Select a container.'),
  locationId: z.string().uuid('Select the location you are standing in.'),
  chassisId: z.string().uuid().nullish(),
  notes: z.string().trim().max(2000).nullish(),
  gps: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional(),
  }).nullish(),
})

/** Hook to a box at a yard or terminal without starting a live move. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const body = await readValidatedJson(event, schema)
  return connectAtLocation(useDb(), auth, body)
})
