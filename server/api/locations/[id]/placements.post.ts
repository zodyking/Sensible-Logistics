import { z } from 'zod'
import { moveContainerOnMap } from '../../../services/placements'
import { requireAuth } from '../../../utils/session'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  containerId: z.string().uuid(),
  placement: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    rotation: z.number(),
  }),
})

/** Reposition a container already sitting on this location's map. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const locationId = getRouterParam(event, 'id')
  if (!locationId) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }
  const body = await readValidatedJson(event, schema)
  return moveContainerOnMap(useDb(), auth, { ...body, locationId })
})
