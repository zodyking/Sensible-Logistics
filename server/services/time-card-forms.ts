import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const TIME_CARD_FORM_PDF = 'short-haul-time-card.pdf'
export const TIME_CARD_FORM_DOCX = 'short-haul-time-card.docx'

function formDiskPaths(name: string): string[] {
  return [
    join(process.cwd(), 'server/assets/forms', name),
    join(process.cwd(), '.output/server/assets/forms', name),
    join(process.cwd(), 'assets/forms', name),
    join('/app/server/assets/forms', name),
    join('/app/.output/server/assets/forms', name),
  ]
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 8 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

export function looksLikeDocx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B
}

function looksLikeForm(name: string, bytes: Uint8Array): boolean {
  if (name.endsWith('.pdf')) return looksLikePdf(bytes)
  if (name.endsWith('.docx')) return looksLikeDocx(bytes)
  return bytes.length > 0
}

/** Nitro/unstorage may hand back a Buffer, a binary string, or JSON `{ type: 'Buffer' }`. */
export function coerceTimeCardFormBytes(raw: unknown): Uint8Array | null {
  if (!raw) return null
  if (raw instanceof Uint8Array) return raw
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) return new Uint8Array(raw)
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  if (typeof raw === 'string') {
    if (raw.startsWith('%PDF') || raw.startsWith('PK')) {
      return new Uint8Array(Buffer.from(raw, 'latin1'))
    }
    const b64 = Buffer.from(raw, 'base64')
    if (looksLikePdf(b64) || looksLikeDocx(b64)) return new Uint8Array(b64)
    const latin1 = new Uint8Array(Buffer.from(raw, 'latin1'))
    return looksLikePdf(latin1) || looksLikeDocx(latin1) ? latin1 : null
  }
  if (typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)) {
    const data = (raw as { data: unknown[] }).data
    if (!data.length || typeof data[0] !== 'number') return null
    return Uint8Array.from(data as number[])
  }
  return null
}

async function fromStorage(name: string): Promise<Uint8Array | null> {
  try {
    const storage = useStorage('assets:time-card-forms')
    const keys = await storage.getKeys().catch(() => [] as string[])
    const ordered = [
      name,
      `/${name}`,
      ...keys.filter(key => key.endsWith(name)),
    ]
    const seen = new Set<string>()
    for (const key of ordered) {
      if (!key || seen.has(key)) continue
      seen.add(key)
      const raw = await storage.getItemRaw(key).catch(() => null)
      const bytes = coerceTimeCardFormBytes(raw)
      if (bytes && looksLikeForm(name, bytes)) return bytes
    }
  }
  catch {
    return null
  }
  return null
}

/** Load a printed-form file that ships next to the server (PDF template or Word blank). */
export async function loadTimeCardForm(name: string): Promise<Uint8Array> {
  const stored = await fromStorage(name)
  if (stored) return stored

  for (const path of formDiskPaths(name)) {
    try {
      const bytes = new Uint8Array(await readFile(path))
      if (looksLikeForm(name, bytes)) return bytes
    }
    catch {
      // Try the next production/dev path.
    }
  }

  throw createError({
    statusCode: 500,
    statusMessage: 'Time card template is missing from the server.',
  })
}
