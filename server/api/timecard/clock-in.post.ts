import { clockIn } from '../../services/timecards'
import { requireDriver } from '../../utils/session'

/** Clock In — the authoritative report-for-duty punch (spec 14.2). */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const card = await clockIn(useDb(), auth)
  return { ok: true, timecard: card }
})
