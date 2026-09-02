import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { chassis, containers } from '../../../database/schema'
import { locationIdsAtSameAddress } from '../../../services/location-sites'
import { requireAuth } from '../../../utils/session'

/**
 * On-site equipment for New Pickup — same occupancy rule as location cards:
 * anything in the active pool whose current location is this yard.
 * `sameAddress=1` also includes boxes parked at other records of this street.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const sameAddress = query.sameAddress === '1' || query.sameAddress === 'true'

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }

  const db = useDb()
  const locationIds = sameAddress
    ? await locationIdsAtSameAddress(db, auth.companyId, id)
    : [id]

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
      inArray(containers.currentLocationId, locationIds),
      sql`${containers.activePoolState} <> 'INACTIVE'`,
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
      inArray(chassis.currentLocationId, locationIds),
      isNull(chassis.deletedAt),
      eq(chassis.outOfService, false),
      isNull(chassis.currentContainerId),
    ))
    .orderBy(chassis.numberNormalized)

  return {
    containers: containerRows,
    chassis: chassisRows,
  }
})
