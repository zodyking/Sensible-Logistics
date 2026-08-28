import { z } from 'zod'
import { completeDropoff } from '../../../services/movements'
import { requireDriver } from '../../../utils/session'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  destinationLocationId: z.string().uuid('Select a drop-off location.'),
  placement: z.object({
    x: z.number(),
    y: z.number(),
    rotation: z.number(),
    zoneId: z.string().uuid().nullish(),
    slotCode: z.string().trim().max(40).nullish(),
  }).nullish(),
  retainChassis: z.boolean().default(false),
  isFinalRelease: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullish(),
  gps: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional(),
  }).nullish(),
})

/** Complete the drop-off and update the container's current state from events. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const tripId = getRouterParam(event, 'id')

  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'Movement id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  return completeDropoff(useDb(), auth, { ...body, tripId })
})
