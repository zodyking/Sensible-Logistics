import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { chassis, containers } from '../../../database/schema'
import { listOpenCsxReleases } from '../../../services/csx-releases'
import { locationIdsAtSameAddress } from '../../../services/location-sites'
import { requireAuth } from '../../../utils/session'
import { csxInventoryId } from '#shared/utils/csx-releases'

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
      isNull(containers.deletedAt),
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

  const releases = await listOpenCsxReleases(db, auth.companyId, locationIds)
  const known = new Set(containerRows.map(row => row.numberNormalized))
  const csxReleases = releases.map(row => ({
    id: row.containerId || csxInventoryId(row.id),
    releaseId: row.id,
    number: row.containerNumber,
    numberNormalized: row.containerNumberNormalized,
    pickupNumber: row.pickupNumber,
    containerType: null as string | null,
    equipmentType: null as string | null,
    isLoaded: false,
    sealNumber: null,
    currentChassisId: null,
    chassisNumber: null,
    csxRelease: true,
  }))

  return {
    containers: containerRows,
    chassis: chassisRows,
    csxReleases: csxReleases.filter(row => !known.has(row.numberNormalized)),
  }
})
