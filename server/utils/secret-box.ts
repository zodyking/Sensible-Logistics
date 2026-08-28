import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function secretKey(): Buffer {
  const secret = process.env.NUXT_SESSION_PASSWORD
    || process.env.DATABASE_URL
    || 'sensible-dev-settings-key'
  return createHash('sha256').update(`sensible-settings:${secret}`).digest()
}

/** AES-256-GCM pack: iv.tag.cipher, all base64url. */
export function sealSecret(plain: string): string {
  if (!plain) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`
}

export function openSecret(packed: string): string {
  if (!packed) return ''
  const [ivPart, tagPart, encPart] = packed.split('.')
  if (!ivPart || !tagPart || !encPart) return ''
  try {
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(ivPart, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }
  catch {
    return ''
  }
}
