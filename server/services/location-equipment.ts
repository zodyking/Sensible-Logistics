import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database, DbExecutor } from '../utils/db'
import { chassis, containerPlacements, containers } from '../database/schema'
import type { Location } from '../database/schema'
import { displayContainers, mapContainerFromRow } from './placements'
import type { GeoJsonPolygon } from '#shared/utils/geo'

/** Same on-site box list as the location equipment page. No load/empty filter. */
export async function listOnSiteContainers(
  db: Database | DbExecutor,
  companyId: string,
  locationIds: string[],
  displayAt: Location,
) {
  if (!locationIds.length) return []

  const items = await db
    .select({
      id: containers.id,
      number: containers.number,
      numberNormalized: containers.numberNormalized,
      equipmentType: containers.equipmentType,
      containerType: containers.containerType,
      isLoaded: containers.isLoaded,
      containerStatus: containers.containerStatus,
      sealNumber: containers.sealNumber,
      currentChassisId: containers.currentChassisId,
      chassisNumber: chassis.number,
      x: containerPlacements.x,
      y: containerPlacements.y,
      rotation: containerPlacements.rotation,
      latitude: containerPlacements.latitude,
      longitude: containerPlacements.longitude,
    })
    .from(containers)
    .leftJoin(
      containerPlacements,
      and(
        eq(containerPlacements.containerId, containers.id),
        inArray(containerPlacements.locationId, locationIds),
        isNull(containerPlacements.supersededAt),
      ),
    )
    .leftJoin(chassis, eq(chassis.id, containers.currentChassisId))
    .where(and(
      eq(containers.companyId, companyId),
      inArray(containers.currentLocationId, locationIds),
      sql`${containers.activePoolState} <> 'INACTIVE'`,
    ))
    .orderBy(containers.numberNormalized)

  return displayContainers(
    items.map(item => mapContainerFromRow({
      ...item,
      boundary: displayAt.boundary as GeoJsonPolygon | null,
      locationLatitude: displayAt.latitude,
      locationLongitude: displayAt.longitude,
    })),
    {
      latitude: displayAt.latitude ? Number(displayAt.latitude) : null,
      longitude: displayAt.longitude ? Number(displayAt.longitude) : null,
      mapHeading: displayAt.mapHeading ?? 0,
      boundary: displayAt.boundary as GeoJsonPolygon | null,
    },
  )
}

export async function listOnSiteChassis(
  db: Database | DbExecutor,
  companyId: string,
  locationIds: string[],
) {
  if (!locationIds.length) return []
  return db
    .select({
      id: chassis.id,
      number: chassis.number,
      provider: chassis.provider,
      sizeCompatibility: chassis.sizeCompatibility,
      status: chassis.status,
    })
    .from(chassis)
    .where(and(
      eq(chassis.companyId, companyId),
      inArray(chassis.currentLocationId, locationIds),
      isNull(chassis.deletedAt),
      eq(chassis.outOfService, false),
      isNull(chassis.currentContainerId),
    ))
    .orderBy(chassis.numberNormalized)
}
