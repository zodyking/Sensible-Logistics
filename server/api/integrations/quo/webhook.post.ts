import { ensureQuoInboundWebhook } from '../../../services/quo'

export default defineEventHandler(async (event) => {
  const auth = await requireUnlockedFeature(event, 'CONNECTIONS')
  try {
    return await ensureQuoInboundWebhook(useDb(), auth.companyId, { force: true })
  }
  catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: error instanceof Error ? error.message : 'Could not register the Quo webhook.',
    })
  }
})
