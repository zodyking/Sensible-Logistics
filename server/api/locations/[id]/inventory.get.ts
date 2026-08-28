import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm'
import { chassis, containers, trips } from '../../../database/schema'
import { requireAuth } from '../../../utils/session'

const LIVE_TRIP_STATUSES = ['PICKUP_IN_PROGRESS', 'IN_TRANSIT', 'DROPOFF_IN_PROGRESS'] as const

/**
 * Boxes and bare chassis sitting at one location, for New Pickup.
 *
 * Claimed equipment and chassis already on a live trip are omitted so the
 * driver cannot start a second movement against them.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }

  const db = useDb()

  const busy = await db
    .select({
      containerId: trips.containerId,
      chassisId: trips.chassisId,
    })
    .from(trips)
    .where(and(
      eq(trips.companyId, auth.companyId),
      inArray(trips.status, [...LIVE_TRIP_STATUSES]),
    ))

  const busyContainerIds = busy.map(row => row.containerId).filter((value): value is string => Boolean(value))
  const busyChassisIds = busy.map(row => row.chassisId).filter((value): value is string => Boolean(value))

  const containerRows = await db
    .select({
      id: containers.id,
      number: containers.number,
      numberNormalized: containers.numberNormalized,
      containerType: containers.containerType,
      equipmentType: containers.equipmentType,
      isLoaded: containers.isLoaded,
      sealNumber: containers.sealNumber,
      currentChassisId: containers.currentChassisId,
      chassisNumber: chassis.number,
      doNotMove: containers.doNotMove,
      activePoolState: containers.activePoolState,
    })
    .from(containers)
    .leftJoin(chassis, eq(chassis.id, containers.currentChassisId))
    .where(and(
      eq(containers.companyId, auth.companyId),
      eq(containers.currentLocationId, id),
      eq(containers.doNotMove, false),
      sql`${containers.activePoolState} not in ('INACTIVE', 'PICKUP_IN_PROGRESS', 'DRIVER_CUSTODY')`,
      busyContainerIds.length ? notInArray(containers.id, busyContainerIds) : sql`true`,
    ))
    .orderBy(containers.numberNormalized)

  const chassisRows = await db
    .select({
      id: chassis.id,
      number: chassis.number,
      provider: chassis.provider,
      sizeCompatibility: chassis.sizeCompatibility,
      status: chassis.status,
    })
    .from(chassis)
    .where(and(
      eq(chassis.companyId, auth.companyId),
      eq(chassis.currentLocationId, id),
      isNull(chassis.deletedAt),
      eq(chassis.outOfService, false),
      isNull(chassis.currentContainerId),
      busyChassisIds.length ? notInArray(chassis.id, busyChassisIds) : sql`true`,
    ))
    .orderBy(chassis.numberNormalized)

  return {
    containers: containerRows,
    chassis: chassisRows,
  }
})
