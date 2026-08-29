import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyQuoWebhookSignature } from '../shared/quo-webhook-signature'

function testWebhookKey() {
  return `whsec_${crypto.randomBytes(32).toString('base64')}`
}

function sign(secretWhsec: string, id: string, ts: string, body: string) {
  const secretBase64 = secretWhsec.startsWith('whsec_') ? secretWhsec.slice(6) : secretWhsec
  const key = Buffer.from(secretBase64, 'base64')
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
  return `v1,${expected}`
}

describe('verifyQuoWebhookSignature', () => {
  it('accepts a valid signature', () => {
    const webhookKey = testWebhookKey()
    const webhookId = 'msg_123'
    const webhookTimestamp = String(Math.floor(Date.now() / 1000))
    const rawBody = '{"type":"message.received"}'
    const webhookSignature = sign(webhookKey, webhookId, webhookTimestamp, rawBody)

    expect(verifyQuoWebhookSignature({
      webhookKey,
      webhookId,
      webhookTimestamp,
      webhookSignature,
      rawBody,
    })).toBe(true)
  })

  it('rejects a bad signature', () => {
    expect(verifyQuoWebhookSignature({
      webhookKey: testWebhookKey(),
      webhookId: 'msg_123',
      webhookTimestamp: String(Math.floor(Date.now() / 1000)),
      webhookSignature: 'v1,not-valid',
      rawBody: '{}',
    })).toBe(false)
  })

  it('rejects a stale timestamp', () => {
    const webhookKey = testWebhookKey()
    const webhookId = 'msg_stale'
    const webhookTimestamp = String(Math.floor(Date.now() / 1000) - 60 * 60)
    const rawBody = '{}'
    expect(verifyQuoWebhookSignature({
      webhookKey,
      webhookId,
      webhookTimestamp,
      webhookSignature: sign(webhookKey, webhookId, webhookTimestamp, rawBody),
      rawBody,
    })).toBe(false)
  })
})
