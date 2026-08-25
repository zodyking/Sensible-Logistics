import { and, asc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { containers, locations } from '../../database/schema'
import { requireAuth } from '../../utils/session'
import { LOCATION_TYPES } from '#shared/utils/domain'

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  type: z.enum(LOCATION_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

/** Shared location pool with live occupancy counts. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)
  const db = useDb()

  const filters = [eq(locations.companyId, auth.companyId), isNull(locations.deletedAt)]
  if (query.type) filters.push(eq(locations.type, query.type))
  if (query.q) {
    const needle = `%${query.q.toLowerCase()}%`
    filters.push(or(
      sql`lower(${locations.name}) like ${needle}`,
      sql`lower(coalesce(${locations.addressLine1}, '')) like ${needle}`,
      sql`lower(coalesce(${locations.city}, '')) like ${needle}`,
      sql`lower(coalesce(${locations.locationCode}, '')) like ${needle}`,
    )!)
  }

  const items = await db
    .select({
      id: locations.id,
      name: locations.name,
      type: locations.type,
      addressLine1: locations.addressLine1,
      city: locations.city,
      state: locations.state,
      capacity: locations.capacity,
      status: locations.status,
      hasBoundary: sql<boolean>`${locations.boundary} is not null`,
      occupancy: sql<number>`(
        select count(*)::int from ${containers} c
        where c.current_location_id = ${locations.id}
          and c.active_pool_state <> 'INACTIVE'
      )`,
    })
    .from(locations)
    .where(and(...filters))
    .orderBy(asc(locations.name))
    .limit(query.limit)

  return { items }
})
