import { aliasedTable, and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { containers, locations, trips } from '../../database/schema'
import { requireAuth } from '../../utils/session'
import { TRIP_STATUSES } from '#shared/utils/domain'

const querySchema = z.object({
  status: z.enum(TRIP_STATUSES).optional(),
  /** Drivers default to their own movements; admins may widen the scope. */
  scope: z.enum(['mine', 'company']).default('mine'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)
  const db = useDb()

  const origin = aliasedTable(locations, 'origin_location')
  const destination = aliasedTable(locations, 'destination_location')

  const filters = [eq(trips.companyId, auth.companyId)]

  if (query.scope === 'mine' || auth.role !== 'ADMIN') {
    if (!auth.driverId) return { items: [] }
    filters.push(eq(trips.driverId, auth.driverId))
  }
  if (query.status) {
    filters.push(inArray(trips.status, [query.status]))
  }

  const items = await db
    .select({
      id: trips.id,
      reference: trips.reference,
      status: trips.status,
      isLoaded: trips.isLoaded,
      createdAt: trips.createdAt,
      pickedUpAt: trips.pickedUpAt,
      completedAt: trips.completedAt,
      containerNumber: containers.number,
      originName: origin.name,
      destinationName: destination.name,
    })
    .from(trips)
    .leftJoin(containers, eq(containers.id, trips.containerId))
    .leftJoin(origin, eq(origin.id, trips.originLocationId))
    .leftJoin(destination, eq(destination.id, trips.destinationLocationId))
    .where(and(...filters))
    .orderBy(desc(trips.createdAt))
    .limit(query.limit)

  return { items }
})
