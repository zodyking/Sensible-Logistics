import { retireChassis } from '../../services/chassis-delete'
import { requireAuth } from '../../utils/session'

/** Move a chassis to Uncategorized, or remove it when it is already there. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Chassis id is required.' })
  }
  return retireChassis(useDb(), auth, id)
})
