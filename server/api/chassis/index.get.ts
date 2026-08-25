import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { chassis } from '../../database/schema'
import { requireAuth } from '../../utils/session'

const querySchema = z.object({
  q: z.string().trim().max(60).optional(),
  /** Hide chassis that are out of service or already carrying a container. */
  availableOnly: z.enum(['true', 'false']).default('false'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)
  const db = useDb()

  const filters = [eq(chassis.companyId, auth.companyId), isNull(chassis.deletedAt)]

  if (query.availableOnly === 'true') {
    filters.push(eq(chassis.outOfService, false))
    filters.push(isNull(chassis.currentContainerId))
  }

  if (query.q) {
    const needle = `%${query.q.toUpperCase().replace(/[^A-Z0-9]/g, '')}%`
    const raw = `%${query.q.toLowerCase()}%`
    filters.push(or(
      sql`${chassis.numberNormalized} like ${needle}`,
      sql`lower(coalesce(${chassis.provider}, '')) like ${raw}`,
    )!)
  }

  const items = await db
    .select({
      id: chassis.id,
      number: chassis.number,
      provider: chassis.provider,
      status: chassis.status,
      outOfService: chassis.outOfService,
      sizeCompatibility: chassis.sizeCompatibility,
      currentContainerId: chassis.currentContainerId,
    })
    .from(chassis)
    .where(and(...filters))
    .orderBy(asc(chassis.numberNormalized))
    .limit(query.limit)

  return { items }
})
