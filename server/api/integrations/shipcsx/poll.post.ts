import { requireAdmin } from '../../../utils/session'
import { runShipcsxPoll } from '../../../services/shipcsx-poll'

/** Admin-triggered ShipCSX poll (still respects the 5am–10pm window). */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  return runShipcsxPoll(useDb())
})
