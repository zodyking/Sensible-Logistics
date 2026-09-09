import { companies } from '../../database/schema'
import { parseQuoMessageReceivedPayload } from '../../../shared/quo-webhook-payload'
import { getQuoConfig, verifyQuoWebhookSignature } from '../../services/quo'

export default defineEventHandler(async (event) => {
  const rawBody = await readRawBody(event)
  const raw = typeof rawBody === 'string' ? rawBody : rawBody ? Buffer.from(rawBody).toString('utf8') : ''
  if (!raw) {
    return { ok: true, ignored: true, reason: 'empty' }
  }

  const webhookId = getHeader(event, 'webhook-id') || ''
  const webhookTimestamp = getHeader(event, 'webhook-timestamp') || ''
  const webhookSignature = getHeader(event, 'webhook-signature') || ''

  const db = useDb()
  const rows = await db.select().from(companies)
  let matched = false

  for (const company of rows) {
    const config = await getQuoConfig(db, company.id)
    if (!config.webhookKey) continue
    const ok = verifyQuoWebhookSignature({
      webhookKey: config.webhookKey,
      webhookId,
      webhookTimestamp,
      webhookSignature,
      rawBody: raw,
    })
    if (ok) {
      matched = true
      break
    }
  }

  if (!matched) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature.' })
  }

  try {
    parseQuoMessageReceivedPayload(JSON.parse(raw))
  }
  catch {
    return { ok: true, ignored: true, reason: 'invalid_json' }
  }

  return { ok: true, ignored: true, reason: 'unhandled' }
})
