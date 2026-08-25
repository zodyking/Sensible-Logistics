import { clockOut } from '../../services/timecards'
import { requireDriver } from '../../utils/session'

/** Clock Out — the authoritative release-from-duty punch, completing the day. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const card = await clockOut(useDb(), auth)
  return { ok: true, timecard: card }
})
