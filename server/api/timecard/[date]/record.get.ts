import { z } from 'zod'
import { buildRoadsideRecord } from '../../../services/timecards'
import { requireAuth } from '../../../utils/session'

const paramSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD work date.')
const querySchema = z.object({
  /** Admins may render another driver's record from a management page. */
  driverId: z.string().uuid().optional(),
})

/**
 * Authoritative §395.1(e)(1) time record, generated from stored data — never
 * from client-side display state (spec 14.4).
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)

  const parsed = paramSchema.safeParse(getRouterParam(event, 'date'))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]!.message })
  }

  if (query.driverId && auth.role !== 'ADMIN' && query.driverId !== auth.driverId) {
    throw createError({ statusCode: 403, statusMessage: 'You can only view your own time record.' })
  }

  const driverId = query.driverId ?? auth.driverId
  if (!driverId) {
    throw createError({ statusCode: 400, statusMessage: 'A driver must be specified.' })
  }

  return buildRoadsideRecord(useDb(), auth, driverId, parsed.data)
})
