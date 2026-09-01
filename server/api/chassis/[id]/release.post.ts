import { releaseChassisHolder } from '../../../services/chassis'
import { requireAuth } from '../../../utils/session'

/** Detach this chassis from the container it is sitting under. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Chassis id is required.' })
  }
  return releaseChassisHolder(useDb(), auth, id)
})
