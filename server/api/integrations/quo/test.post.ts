import { z } from 'zod'
import { testQuoConnection } from '../../../services/quo'

const schema = z.object({
  apiKey: z.string().max(400).optional(),
})

export default defineEventHandler(async (event) => {
  const auth = await requireUnlockedFeature(event, 'CONNECTIONS')
  const raw = await readBody(event).catch(() => ({}))
  const parsed = schema.safeParse(raw ?? {})
  if (!parsed.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'The submitted data is not valid.',
    })
  }
  const apiKey = parsed.data.apiKey?.trim()
  return testQuoConnection(useDb(), auth.companyId, apiKey || undefined)
})
