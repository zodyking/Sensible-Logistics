import { z } from 'zod'
import { listDriverTimeCards } from '../../services/time-cards'
import { requireDriver } from '../../utils/session'

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(120).default(60),
})

/** Daily short-haul cards for the signed-in driver, newest first. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const query = readValidatedQuery(event, querySchema)
  const items = await listDriverTimeCards(useDb(), auth, query.limit)
  return { items }
})
