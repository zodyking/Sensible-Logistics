import { loadYardView } from '../../../services/yard-generate'
import { requireAuth } from '../../../utils/session'

/** Current generated yard plan plus chassis positions. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const locationId = getRouterParam(event, 'id')
  if (!locationId) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }
  return loadYardView(useDb(), auth, locationId)
})
