import { z } from 'zod'
import { startPickup } from '../../services/movements'
import { requireDriver } from '../../utils/session'
import { CONTAINER_TYPES, EQUIPMENT_TYPES } from '#shared/utils/domain'

const schema = z.object({
  /** Client-generated event UUID, reused verbatim on retries (spec 33.2). */
  eventId: z.string().uuid('An idempotency key is required.'),
  containerNumber: z.string().trim().min(1).max(40),
  containerType: z.enum(CONTAINER_TYPES),
  equipmentType: z.enum(EQUIPMENT_TYPES).optional(),
  originLocationId: z.string().uuid('Select a pickup location.'),
  gps: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional(),
  }).nullish(),
})

/**
 * Activate the container and open a pickup-in-progress movement.
 *
 * Returns 409 with the current holder when another driver already has a claim,
 * which drives the conflict screen.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const body = await readValidatedJson(event, schema)

  return startPickup(useDb(), auth, body)
})
