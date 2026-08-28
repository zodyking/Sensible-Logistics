import { companies } from '../../database/schema'
import {
  evaluateQuoInboundMessage,
  parseQuoMessageReceivedPayload,
} from '../../../shared/quo-webhook-payload'
import { getQuoConfig, verifyQuoWebhookSignature } from '../../services/quo'
import { handleInboundPhoneCode } from '../../services/phone-verification'
import { toE164 } from '../../../shared/utils/phone'

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
  let matched: { id: string, fromNumber: string } | null = null

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
      matched = { id: company.id, fromNumber: config.fromNumber }
      break
    }
  }

  if (!matched) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature.' })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  }
  catch {
    return { ok: true, ignored: true, reason: 'invalid_json' }
  }

  const parsed = parseQuoMessageReceivedPayload(payload)
  const decision = evaluateQuoInboundMessage(parsed, matched.fromNumber)
  if (decision.ignore) {
    return { ok: true, ignored: true, reason: decision.reason }
  }

  const handled = await handleInboundPhoneCode(db, {
    companyId: matched.id,
    fromE164: toE164(parsed.fromPhone),
    toE164: toE164(parsed.toPhone),
    text: parsed.body,
  })

  return { ok: true, ignored: !handled, handled }
})
