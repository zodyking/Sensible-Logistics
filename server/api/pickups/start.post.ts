import { z } from 'zod'
import { startPickup } from '../../services/movements'
import { requireDriver } from '../../utils/session'
import { CONTAINER_TYPES, EQUIPMENT_TYPES, TRIP_KINDS } from '#shared/utils/domain'

const schema = z.object({
  /** Client-generated event UUID, reused verbatim on retries (spec 33.2). */
  eventId: z.string().uuid('An idempotency key is required.'),
  kind: z.enum(TRIP_KINDS).default('CONTAINER'),
  containerNumber: z.string().trim().min(1).max(40).optional(),
  containerType: z.enum(CONTAINER_TYPES).optional(),
  equipmentType: z.enum(EQUIPMENT_TYPES).optional(),
  chassisId: z.string().uuid().optional(),
  originLocationId: z.string().uuid('Select a pickup location.'),
  swapOfTripId: z.string().uuid().optional(),
  gps: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional(),
  }).nullish(),
}).superRefine((body, ctx) => {
  if (body.kind === 'BARE_CHASSIS' && !body.chassisId) {
    ctx.addIssue({ code: 'custom', message: 'Enter a chassis number.', path: ['chassisId'] })
  }
  if (body.kind === 'CONTAINER' && !body.containerNumber) {
    ctx.addIssue({ code: 'custom', message: 'Enter a container number.', path: ['containerNumber'] })
  }
  if (body.kind === 'CONTAINER' && !body.containerType) {
    ctx.addIssue({ code: 'custom', message: 'Select a container type.', path: ['containerType'] })
  }
})

/**
 * Activate the container (or a bare chassis) and open a pickup-in-progress movement.
 *
 * Returns 409 with the current holder when another driver already has a claim,
 * which drives the conflict screen.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const body = await readValidatedJson(event, schema)

  return startPickup(useDb(), auth, body)
})
