import { z } from 'zod'
import { completeDropoff } from '../../../services/movements'
import { requireDriver } from '../../../utils/session'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  destinationLocationId: z.string().uuid('Select a drop-off location.'),
  placement: z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    rotation: z.number(),
    x: z.number().optional(),
    y: z.number().optional(),
    zoneId: z.string().uuid().nullish(),
    slotCode: z.string().trim().max(40).nullish(),
  }).nullish(),
  retainChassis: z.boolean().default(false),
  isFinalRelease: z.boolean().default(false),
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
