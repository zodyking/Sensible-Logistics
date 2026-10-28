import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { TimeCardHeader, TimeCardStop } from '#shared/utils/time-card'
import { timeCardDrawPlan, timeCardPdfY } from '#shared/utils/time-card-layout'

const TEMPLATE_NAME = 'short-haul-time-card.pdf'

function winAnsi(text: string): string {
  return text.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function loadTemplateBytes(): Promise<Uint8Array> {
  try {
    const storage = useStorage('assets:time-card-forms')
    const raw = await storage.getItemRaw(TEMPLATE_NAME)
    if (raw) {
      if (raw instanceof Uint8Array) return raw
      if (Buffer.isBuffer(raw)) return new Uint8Array(raw)
      if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
    }
  }
  catch {
    // Dev and vitest read the file from disk.
  }
  return readFile(join(process.cwd(), 'server/assets/forms', TEMPLATE_NAME))
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
    page.drawText(text, {
      x: op.x,
      y: timeCardPdfY(op.topY),
      size: op.size,
      font,
      color: ink,
    })
  }

  return pdf.save({ useObjectStreams: false })
}
