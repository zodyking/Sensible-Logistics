import { loadResetCounts } from '../services/data-reset'

export default defineEventHandler(async (event) => {
  const auth = await requireUnlockedFeature(event, 'RESET')
  return loadResetCounts(useDb(), auth.companyId, auth.userId)
})
