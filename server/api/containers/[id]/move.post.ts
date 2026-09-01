import { z } from 'zod'
import { moveContainerToLocation } from '../../../services/placements'
import { requireAuth } from '../../../utils/session'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  destinationLocationId: z.string().uuid('Pick a location.'),
})

/** Move a parked container from one yard to another as a correction. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Container id is required.' })
  }
  const body = await readValidatedJson(event, schema)
  return moveContainerToLocation(useDb(), auth, {
    eventId: body.eventId,
    containerId: id,
    destinationLocationId: body.destinationLocationId,
  })
})
