import { loadTimeCardForm, TIME_CARD_FORM_DOCX } from '../../services/time-card-forms'
import { requireAuth } from '../../utils/session'
import { timeCardTemplateDocxFileName } from '#shared/utils/time-card'

/** Blank two-page short-haul card as a Word document, 1:1 with the printed PDF. */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const bytes = await loadTimeCardForm(TIME_CARD_FORM_DOCX)
  const body = Buffer.from(bytes)
  setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  setHeader(event, 'Content-Disposition', `attachment; filename="${timeCardTemplateDocxFileName()}"`)
  setHeader(event, 'Cache-Control', 'private, max-age=300')
  return body
})
