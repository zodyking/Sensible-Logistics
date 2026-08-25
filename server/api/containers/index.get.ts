import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { containers, drivers, locations, users } from '../../database/schema'
import { requireAuth } from '../../utils/session'
import { ACTIVE_POOL_STATES, CONTAINER_TYPES } from '#shared/utils/domain'
import { normalizeContainerNumber } from '#shared/utils/iso6346'

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  state: z.enum(ACTIVE_POOL_STATES).optional(),
  type: z.enum(CONTAINER_TYPES).optional(),
  loaded: z.enum(['true', 'false']).optional(),
  locationId: z.string().uuid().optional(),
  /** `active` hides released containers; `all` includes full history. */
  scope: z.enum(['active', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

/** Container search — partial identifier matching is the fastest path (spec 11). */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)
  const db = useDb()

  const filters = [eq(containers.companyId, auth.companyId), isNull(containers.deletedAt)]

  if (query.scope === 'active') {
    filters.push(inArray(containers.activePoolState, ACTIVE_POOL_STATES.filter(s => s !== 'INACTIVE')))
  }
  if (query.state) filters.push(eq(containers.activePoolState, query.state))
  if (query.type) filters.push(eq(containers.containerType, query.type))
  if (query.loaded) filters.push(eq(containers.isLoaded, query.loaded === 'true'))
  if (query.locationId) filters.push(eq(containers.currentLocationId, query.locationId))

  if (query.q) {
    const needle = `%${normalizeContainerNumber(query.q)}%`
    const raw = `%${query.q.toLowerCase()}%`
    filters.push(or(
      sql`${containers.numberNormalized} like ${needle}`,
      sql`lower(coalesce(${containers.sealNumber}, '')) like ${raw}`,
      sql`lower(coalesce(${containers.bookingNumber}, '')) like ${raw}`,
      sql`lower(coalesce(${containers.billOfLading}, '')) like ${raw}`,
      sql`lower(coalesce(${containers.customerReference}, '')) like ${raw}`,
    )!)
  }

  const where = and(...filters)

  const rows = await db
    .select({
      id: containers.id,
      number: containers.number,
      numberNormalized: containers.numberNormalized,
      containerType: containers.containerType,
      equipmentType: containers.equipmentType,
      isLoaded: containers.isLoaded,
      activePoolState: containers.activePoolState,
      checkDigitValid: containers.checkDigitValid,
      sealNumber: containers.sealNumber,
      lastActivityAt: containers.lastActivityAt,
      lastFreeDay: containers.lastFreeDay,
      isDamaged: containers.isDamaged,
      customsHold: containers.customsHold,
      locationId: locations.id,
      locationName: locations.name,
      driverName: sql<string | null>`nullif(concat_ws(' ', ${users.firstName}, ${users.lastName}), '')`,
    })
    .from(containers)
    .leftJoin(locations, eq(locations.id, containers.currentLocationId))
    .leftJoin(drivers, eq(drivers.id, containers.currentDriverId))
    .leftJoin(users, eq(users.id, drivers.userId))
    .where(where)
    .orderBy(desc(containers.lastActivityAt), desc(containers.createdAt))
    .limit(query.limit)
    .offset(query.offset)

  const [counts] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(containers)
    .where(where)

  return { items: rows, total: counts?.total ?? 0, limit: query.limit, offset: query.offset }
})
