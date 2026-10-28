import { getDriverTimeCard } from '../../../services/time-cards'
import { fillTimeCardPdf } from '../../../services/time-card-pdf'
import { requireDriver } from '../../../utils/session'
import { timeCardPdfFileName } from '#shared/utils/time-card'

/** Exact two-page short-haul PDF, filled from the day's card. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const workDate = getRouterParam(event, 'date')
  if (!workDate) {
    throw createError({ statusCode: 400, statusMessage: 'Work date is required.' })
  }

  const card = await getDriverTimeCard(useDb(), auth, workDate)
  const bytes = await fillTimeCardPdf(card.header, card.stops)
  const fileName = timeCardPdfFileName(card.workDate)
  const download = getQuery(event).download === '1'

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${fileName}"`)
  setHeader(event, 'Cache-Control', 'private, max-age=30')
  setHeader(event, 'Content-Length', String(bytes.byteLength))
  return bytes
})
