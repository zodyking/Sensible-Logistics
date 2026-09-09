import { requireAdmin } from '../../utils/session'
import { loadDesk } from '../../services/dispatch-desk'

/** Dispatcher desk: one driver's day of tasks, trips, and the container pool. */
export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event)
  const query = getQuery(event)
  const driverId = typeof query.driverId === 'string' ? query.driverId : undefined
  const date = typeof query.date === 'string' ? query.date : undefined
  return loadDesk(useDb(), auth, { driverId, date })
})
