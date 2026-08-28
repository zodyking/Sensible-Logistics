import { createHmac, timingSafeEqual } from 'node:crypto'

/** HMAC-SHA256 over `${webhookId}.${timestamp}.${rawBody}` using the `whsec_` key. */
export function verifyQuoWebhookSignature(input: {
  webhookKey: string
  webhookId: string
  webhookTimestamp: string
  webhookSignature: string
  rawBody: string
  maxAgeSeconds?: number
}): boolean {
  const secret = input.webhookKey.trim()
  if (!secret || !input.webhookId || !input.webhookTimestamp || !input.webhookSignature) return false

  const timestamp = Number(input.webhookTimestamp)
  const now = Math.floor(Date.now() / 1000)
  const maxAge = input.maxAgeSeconds ?? 5 * 60
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > maxAge) return false

  const secretBase64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  let secretBytes: Buffer
  try {
    secretBytes = Buffer.from(secretBase64, 'base64')
  }
  catch {
    return false
  }
  if (!secretBytes.length) return false

  const signedContent = `${input.webhookId}.${input.webhookTimestamp}.${input.rawBody}`
  const expectedSignature = createHmac('sha256', secretBytes).update(signedContent).digest('base64')
  const provided = input.webhookSignature
    .split(' ')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [version, signature] = entry.split(',')
      return version === 'v1' ? signature : undefined
    })
    .filter((signature): signature is string => Boolean(signature))

  return provided.some((signature) => {
    const left = Buffer.from(signature)
    const right = Buffer.from(expectedSignature)
    return left.length === right.length && timingSafeEqual(left, right)
  })
}
