import { z } from 'zod'
import { saveQuoSettings } from '../../../services/quo'

const SAVED_API_KEY_MASK = '••••••••••••'

const schema = z.object({
  enabled: z.boolean().optional(),
  apiKey: z.string().max(400).optional(),
  fromNumber: z.string().trim().max(30).optional(),
})

export default defineEventHandler(async (event) => {
  const auth = await requireUnlockedFeature(event, 'CONNECTIONS')
  const body = await readValidatedJson(event, schema)
  const apiKey = body.apiKey && body.apiKey !== SAVED_API_KEY_MASK
    ? body.apiKey
    : undefined
  return saveQuoSettings(useDb(), auth.companyId, {
    enabled: body.enabled,
    apiKey,
    fromNumber: body.fromNumber,
  })
})
