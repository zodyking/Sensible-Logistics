import { addIsoDays, calendarDateInZone } from '#shared/utils/sms-task'
import { requireDriver } from '../../utils/session'
import { companyTimezone, getOrCreateEndpoint, listDriverTasks, publicAppOrigin, setupView } from '../../services/tasks'

/** Driver task inbox plus webhook setup status. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const db = useDb()
  const timezone = await companyTimezone(db, auth.companyId)
  const todayIso = calendarDateInZone(new Date(), timezone)
  const sinceIso = addIsoDays(todayIso, -21)

  const [endpoint, tasks] = await Promise.all([
    getOrCreateEndpoint(db, auth),
    listDriverTasks(db, auth, { sinceIso, limit: 100 }),
  ])

  return {
    todayIso,
    timezone,
    setup: setupView(endpoint, publicAppOrigin(event)),
    tasks,
  }
})
