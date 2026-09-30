import { retireContainer } from '../../services/container-delete'
import { requireAuth } from '../../utils/session'

/** Move a container to Uncategorized, or remove it when it is already there. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Container id is required.' })
  }
  return retireContainer(useDb(), auth, id)
})
