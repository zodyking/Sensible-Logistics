import { z } from 'zod'
import { attachContainerToTrip } from '../../../services/movements'
import { requireDriver } from '../../../utils/session'
import { CONTAINER_TYPES, EQUIPMENT_TYPES } from '#shared/utils/domain'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  containerNumber: z.string().trim().min(1).max(40),
  containerType: z.enum(CONTAINER_TYPES),
  equipmentType: z.enum(EQUIPMENT_TYPES).optional(),
  isLoaded: z.boolean().default(true),
  sealNumber: z.string().trim().max(60).nullish(),
})

/** Hang a container on a live bare-chassis movement. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const tripId = getRouterParam(event, 'id')
  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'Movement id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  return attachContainerToTrip(useDb(), auth, { ...body, tripId })
})
