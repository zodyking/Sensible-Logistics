import { releaseContainerFromDriver } from '../../../services/movements'
import { requireAuth } from '../../../utils/session'

/** Drop a live driver claim so the box can be scanned into a yard or a new trip. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const containerId = getRouterParam(event, 'id')
  if (!containerId) {
    throw createError({ statusCode: 400, statusMessage: 'Container id is required.' })
  }

  return releaseContainerFromDriver(useDb(), auth, containerId)
})
