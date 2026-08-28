import { getQuoSettingsView } from '../../../services/quo'

export default defineEventHandler(async (event) => {
  const auth = await requireUnlockedFeature(event, 'CONNECTIONS')
  return getQuoSettingsView(useDb(), auth.companyId)
})
