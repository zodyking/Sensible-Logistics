import { getDriverTimeCard } from '../../services/time-cards'
import { requireDriver } from '../../utils/session'

/** Today's (or a past day's) short-haul card, synced from trips and GPS. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const workDate = getRouterParam(event, 'date')
  if (!workDate) {
    throw createError({ statusCode: 400, statusMessage: 'Work date is required.' })
  }
  const card = await getDriverTimeCard(useDb(), auth, workDate)
  return { card }
})
