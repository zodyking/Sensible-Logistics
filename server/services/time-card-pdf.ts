import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { TimeCardHeader, TimeCardStop } from '#shared/utils/time-card'
import { timeCardDrawPlan, timeCardPdfY } from '#shared/utils/time-card-layout'

const TEMPLATE_NAME = 'short-haul-time-card.pdf'
const PDF_MAGIC = Buffer.from('%PDF')

function winAnsi(text: string): string {
  return text.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, ' ').replace(/\s+/g, ' ').trim()
}

function isPdfMagic(bytes: Uint8Array): boolean {
  return bytes.length > 8
    && bytes[0] === PDF_MAGIC[0]
    && bytes[1] === PDF_MAGIC[1]
    && bytes[2] === PDF_MAGIC[2]
    && bytes[3] === PDF_MAGIC[3]
}

/** Nitro/unstorage may hand back a Buffer, a binary string, or JSON `{ type: 'Buffer' }`. */
export function coerceTimeCardPdfBytes(raw: unknown): Uint8Array | null {
  if (!raw) return null
  if (raw instanceof Uint8Array) return raw
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) return new Uint8Array(raw)
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  if (typeof raw === 'string') {
    if (raw.startsWith('%PDF')) return new Uint8Array(Buffer.from(raw, 'latin1'))
    const b64 = Buffer.from(raw, 'base64')
    if (isPdfMagic(b64)) return new Uint8Array(b64)
    const latin1 = new Uint8Array(Buffer.from(raw, 'latin1'))
    return isPdfMagic(latin1) ? latin1 : null
  }
  if (typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)) {
    const data = (raw as { data: unknown[] }).data
    if (!data.length || typeof data[0] !== 'number') return null
    return Uint8Array.from(data as number[])
  }
  return null
}

export function timeCardTemplateDiskPaths(): string[] {
  return [
    join(process.cwd(), 'server/assets/forms', TEMPLATE_NAME),
    join(process.cwd(), 'assets/forms', TEMPLATE_NAME),
    join('/app/server/assets/forms', TEMPLATE_NAME),
  ]
}

async function fromStorage(): Promise<Uint8Array | null> {
  try {
    const storage = useStorage('assets:time-card-forms')
    const keys = await storage.getKeys().catch(() => [] as string[])
    const ordered = [
      TEMPLATE_NAME,
      `/${TEMPLATE_NAME}`,
      ...keys.filter(key => key.endsWith(TEMPLATE_NAME) || key.endsWith('.pdf')),
    ]
    const seen = new Set<string>()
    for (const key of ordered) {
      if (!key || seen.has(key)) continue
      seen.add(key)
      const raw = await storage.getItemRaw(key).catch(() => null)
      const bytes = coerceTimeCardPdfBytes(raw)
      if (bytes && isPdfMagic(bytes)) return bytes
    }
  }
  catch {
    return null
  }
  return null
}

async function loadTemplateBytes(): Promise<Uint8Array> {
  const stored = await fromStorage()
  if (stored) return stored

  for (const path of timeCardTemplateDiskPaths()) {
    try {
      const bytes = new Uint8Array(await readFile(path))
      if (isPdfMagic(bytes)) return bytes
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

/** Overlay filled values on the exact two-page printed short-haul card. */
export async function fillTimeCardPdf(header: TimeCardHeader, stops: TimeCardStop[]): Promise<Uint8Array> {
  const template = await loadTemplateBytes()
  const pdf = await PDFDocument.load(template)
  const pages = pdf.getPages()
  const page = pages[0]
  if (!page) {
    throw createError({ statusCode: 500, statusMessage: 'Time card template is missing page 1.' })
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const ink = rgb(0.07, 0.12, 0.2)

  for (const op of timeCardDrawPlan(header, stops)) {
    const text = winAnsi(op.text)
    if (!text) continue
    const draw = (value: string) => page.drawText(value, {
      x: op.x,
      y: timeCardPdfY(op.topY),
      size: op.size,
      font,
      color: ink,
    })
    try {
      draw(text)
    }
    catch {
      const ascii = text.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim()
      if (ascii) draw(ascii)
    }
  }

  return pdf.save({ useObjectStreams: false })
}
