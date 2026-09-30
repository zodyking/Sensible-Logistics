import { softDeleteContainer } from '../../services/container-delete'
import { requireAuth } from '../../utils/session'

/** Soft-delete a container. Open trips must be finished or cancelled first. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Container id is required.' })
  }
  return softDeleteContainer(useDb(), auth, id)
})
