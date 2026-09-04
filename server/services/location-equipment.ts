import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database, DbExecutor } from '../utils/db'
import { chassis, containerEvents, containerPlacements, containers, locations } from '../database/schema'
import type { Location } from '../database/schema'
import { displayContainers, mapContainerFromRow } from './placements'
import type { GeoJsonPolygon } from '#shared/utils/geo'
import { occupancyFromEvents, type Occupancy } from '#shared/utils/occupancy'
import type { EventType, LocationType } from '#shared/utils/domain'

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

  const mapped = displayContainers(
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

  const occupancy = await occupancyByContainerIds(db, companyId, mapped.map(item => item.id))
  return mapped
    .map(item => ({ ...item, occupancy: occupancy.get(item.id) ?? null }))
    .sort((a, b) => {
      const aDays = a.occupancy?.daysOld
      const bDays = b.occupancy?.daysOld
      if (aDays != null && bDays != null && aDays !== bDays) return bDays - aDays
      if (aDays != null && bDays == null) return -1
      if (aDays == null && bDays != null) return 1
      return (a.numberNormalized ?? a.number).localeCompare(b.numberNormalized ?? b.number)
    })
}

async function occupancyByContainerIds(
  db: Database | DbExecutor,
  companyId: string,
  containerIds: string[],
): Promise<Map<string, Occupancy>> {
  const result = new Map<string, Occupancy>()
  if (!containerIds.length) return result

  const rows = await db
    .select({
      containerId: containerEvents.containerId,
      eventType: containerEvents.eventType,
      occurredAt: containerEvents.occurredAt,
      locationType: locations.type,
    })
    .from(containerEvents)
    .leftJoin(locations, eq(locations.id, containerEvents.locationId))
    .where(and(
      eq(containerEvents.companyId, companyId),
      inArray(containerEvents.containerId, containerIds),
      inArray(containerEvents.eventType, ['PICKUP_CONFIRMED', 'DROPOFF_CONFIRMED']),
    ))

  const byContainer = new Map<string, Array<{
    eventType: EventType
    occurredAt: Date
    locationType: LocationType | null
  }>>()

  for (const row of rows) {
    if (!row.containerId) continue
    const list = byContainer.get(row.containerId) ?? []
    list.push({
      eventType: row.eventType as EventType,
      occurredAt: row.occurredAt,
      locationType: (row.locationType ?? null) as LocationType | null,
    })
    byContainer.set(row.containerId, list)
  }

  for (const [id, events] of byContainer) {
    const occupancy = occupancyFromEvents(events)
    if (occupancy) result.set(id, occupancy)
  }

  return result
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
