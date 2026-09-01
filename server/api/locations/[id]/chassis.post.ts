import { z } from 'zod'
import { addChassisAtLocation } from '../../../services/placements'
import { requireAuth } from '../../../utils/session'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  chassisNumber: z.string().trim().min(1),
})

/** Park a bare chassis at this location without a trip. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const locationId = getRouterParam(event, 'id')
  if (!locationId) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }
  const body = await readValidatedJson(event, schema)
  return addChassisAtLocation(useDb(), auth, { ...body, locationId })
})
