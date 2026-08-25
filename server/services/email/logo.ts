import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MailAttachment } from '../mail'

/** Content-ID for the inline brand mark. Must match the img src `cid:`. */
export const EMAIL_LOGO_CID = 'logo@sensible-logistics'

/**
 * Resolve the PNG shipped in `public/brand/logo.png`.
 *
 * Dev serves it from `public/`. Production (Nitro and the Docker image) copies
 * public assets to `.output/public/`, so both locations are checked.
 */
export function resolveEmailLogoPath(): string | null {
  const candidates = [
    join(process.cwd(), 'public/brand/logo.png'),
    join(process.cwd(), '.output/public/brand/logo.png'),
  ]
  for (const path of candidates) {
    if (existsSync(path)) return path
  }
  return null
}

export function logoAttachment(path: string): MailAttachment {
  return {
    filename: 'logo.png',
    path,
    cid: EMAIL_LOGO_CID,
    contentType: 'image/png',
    contentDisposition: 'inline',
  }
}
