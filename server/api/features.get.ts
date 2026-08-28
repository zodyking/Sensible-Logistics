import { loadUnlockedFeatures } from '../services/features'

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  return { unlocked: await loadUnlockedFeatures(useDb(), auth.userId) }
})
