import { aliasedTable, and, desc, eq, inArray, ne } from 'drizzle-orm'
import { z } from 'zod'
import { chassis, containers, locations, tripGaps, trips } from '../../database/schema'
import { requireAuth } from '../../utils/session'
import { TRIP_STATUSES } from '#shared/utils/domain'
import type { GapResolution } from '#shared/utils/trip-gaps'

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
  else {
    filters.push(ne(trips.status, 'CANCELLED'))
  }

  const items = await db
    .select({
      id: trips.id,
      reference: trips.reference,
      status: trips.status,
      isLoaded: trips.isLoaded,
      createdAt: trips.createdAt,
      pickedUpAt: trips.pickedUpAt,
      droppedOffAt: trips.droppedOffAt,
      completedAt: trips.completedAt,
      containerNumber: containers.number,
      containerType: containers.containerType,
      chassisNumber: chassis.number,
      kind: trips.kind,
      swapPairTripId: trips.swapPairTripId,
      originLocationId: trips.originLocationId,
      destinationLocationId: trips.destinationLocationId,
      originName: origin.name,
      destinationName: destination.name,
    })
    .from(trips)
    .leftJoin(containers, eq(containers.id, trips.containerId))
    .leftJoin(chassis, eq(chassis.id, trips.chassisId))
    .leftJoin(origin, eq(origin.id, trips.originLocationId))
    .leftJoin(destination, eq(destination.id, trips.destinationLocationId))
    .where(and(...filters))
    .orderBy(desc(trips.createdAt))
    .limit(query.limit)

  const tripIds = items.map(item => item.id)
  const gapResolutions = tripIds.length
    ? await db
        .select({
          priorTripId: tripGaps.priorTripId,
          nextTripId: tripGaps.nextTripId,
          resolution: tripGaps.resolution,
        })
        .from(tripGaps)
        .where(and(
          eq(tripGaps.companyId, auth.companyId),
          inArray(tripGaps.nextTripId, tripIds),
        ))
    : []

  return {
    items,
    gapResolutions: gapResolutions.map(row => ({
      priorTripId: row.priorTripId,
      nextTripId: row.nextTripId,
      resolution: (row.resolution === 'BOBTAIL' ? 'BOBTAIL' : 'MISSING') as GapResolution,
    })),
  }
})
