import { addIsoDays, calendarDateInZone } from '#shared/utils/sms-task'
import { companyTimezone, listDriverTasks } from '../../services/tasks'
import { requireDriver } from '../../utils/session'

/** Driver task inbox. Drafts stay on the dispatch desk until submitted. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const db = useDb()
  const timezone = await companyTimezone(db, auth.companyId)
  const todayIso = calendarDateInZone(new Date(), timezone)
  const sinceIso = addIsoDays(todayIso, -21)

  return {
    todayIso,
    timezone,
    tasks: await listDriverTasks(db, auth, { sinceIso, limit: 100 }),
  }
})
