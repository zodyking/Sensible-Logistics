import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { TimeCardHeader, TimeCardStop } from '#shared/utils/time-card'
import { timeCardDrawPlan, timeCardPdfY } from '#shared/utils/time-card-layout'
import {
  coerceTimeCardFormBytes,
  loadTimeCardForm,
  TIME_CARD_FORM_PDF,
} from './time-card-forms'

export const coerceTimeCardPdfBytes = coerceTimeCardFormBytes

function winAnsi(text: string): string {
  return text.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Overlay filled values on the exact two-page printed short-haul card. */
export async function fillTimeCardPdf(header: TimeCardHeader, stops: TimeCardStop[]): Promise<Uint8Array> {
  const template = await loadTimeCardForm(TIME_CARD_FORM_PDF)
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
