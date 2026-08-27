import { z } from 'zod'
import { swapAtLocation } from '../../services/movements'
import { documentChecklistForLocation } from '#shared/utils/workflow'
import { requireDriver } from '../../utils/session'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  pickupContainerId: z.string().uuid('Select the container you are picking up.'),
  locationId: z.string().uuid('Swap both boxes at the same location.'),
  chassisId: z.string().uuid().nullish(),
  notes: z.string().trim().max(2000).nullish(),
  gps: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional(),
  }).nullish(),
})

/** Drop the hooked box and pick another in one motion, then prompt for documents. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const body = await readValidatedJson(event, schema)
  const result = await swapAtLocation(useDb(), auth, body)
  const checklist = documentChecklistForLocation(result.locationType)

  return {
    ...result,
    documentPrompt: {
      title: 'Upload swap documents',
      locationType: result.locationType,
      tripId: result.trip?.id ?? null,
      containerId: result.picked.id,
      checklist,
    },
  }
})
