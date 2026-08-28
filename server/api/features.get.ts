import { readUnlockedFeatures } from '../../utils/session'

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const session = await getUserSession(event)
  return { unlocked: readUnlockedFeatures(session) }
})
