import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { containerPlacements, containers, chassis, locations } from '../../database/schema'
import { displayContainers, mapContainerFromRow } from '../../services/placements'
import { requireAuth } from '../../utils/session'
import { countContainersByType, emptyTypeCounts, LOCATION_TYPES } from '#shared/utils/domain'
import type { GeoJsonPolygon } from '#shared/utils/geo'

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  type: z.enum(LOCATION_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  includeUncategorized: z.enum(['1', 'true']).optional(),
  /** Skip container occupancy — pickup / drop-off pickers only need the site list. */
  lite: z.enum(['1', 'true']).optional(),
})

/** Shared location pool with live occupancy, brand counts, and map placements. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)
  const db = useDb()

  const filters = [eq(locations.companyId, auth.companyId), isNull(locations.deletedAt)]
  if (!query.includeUncategorized) filters.push(eq(locations.isUncategorized, false))
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

  const rows = await db
    .select({
      id: locations.id,
      name: locations.name,
      type: locations.type,
      locationCode: locations.locationCode,
      addressLine1: locations.addressLine1,
      city: locations.city,
      state: locations.state,
      mainPhone: locations.mainPhone,
      contactPhone: locations.contactPhone,
      capacity: locations.capacity,
      status: locations.status,
      isUncategorized: locations.isUncategorized,
      latitude: locations.latitude,
      longitude: locations.longitude,
      boundary: locations.boundary,
      mapHeading: locations.mapHeading,
      hasBoundary: sql<boolean>`${locations.boundary} is not null`,
    })
    .from(locations)
    .where(and(...filters))
    .orderBy(asc(locations.name))
    .limit(query.limit)

  const locationIds = rows.map(row => row.id)
  const chassisOnSite = locationIds.length
    ? await db
        .select({
          locationId: chassis.currentLocationId,
          count: sql<number>`count(*)::int`,
        })
        .from(chassis)
        .where(and(
          eq(chassis.companyId, auth.companyId),
          inArray(chassis.currentLocationId, locationIds),
          isNull(chassis.deletedAt),
          eq(chassis.outOfService, false),
          isNull(chassis.currentContainerId),
        ))
        .groupBy(chassis.currentLocationId)
    : []
  const chassisByLocation = new Map(
    chassisOnSite
      .filter((row): row is typeof row & { locationId: string } => Boolean(row.locationId))
      .map(row => [row.locationId, Number(row.count)]),
  )

  if (query.lite) {
    return {
      items: rows.map(row => ({
        id: row.id,
        name: row.name,
        type: row.type,
        locationCode: row.locationCode,
        addressLine1: row.addressLine1,
        city: row.city,
        state: row.state,
        mainPhone: row.mainPhone,
        contactPhone: row.contactPhone,
        capacity: row.capacity,
        status: row.status,
        isUncategorized: row.isUncategorized,
        latitude: row.latitude ? Number(row.latitude) : null,
        longitude: row.longitude ? Number(row.longitude) : null,
        mapHeading: row.mapHeading ?? 0,
        boundary: row.boundary,
        hasBoundary: row.hasBoundary,
        occupancy: 0,
        availableChassis: chassisByLocation.get(row.id) ?? 0,
        typeCounts: emptyTypeCounts(),
        containers: [],
      })),
    }
  }

  const onSite = locationIds.length
    ? await db
        .select({
          id: containers.id,
          number: containers.number,
          numberNormalized: containers.numberNormalized,
          equipmentType: containers.equipmentType,
          containerType: containers.containerType,
          isLoaded: containers.isLoaded,
          currentLocationId: containers.currentLocationId,
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
            eq(containerPlacements.locationId, containers.currentLocationId),
            isNull(containerPlacements.supersededAt),
          ),
        )
        .leftJoin(chassis, eq(chassis.id, containers.currentChassisId))
        .where(and(
          eq(containers.companyId, auth.companyId),
          inArray(containers.currentLocationId, locationIds),
          isNull(containers.deletedAt),
          sql`${containers.activePoolState} <> 'INACTIVE'`,
        ))
    : []

  const byLocation = new Map<string, typeof onSite>()
  for (const item of onSite) {
    const key = item.currentLocationId
    if (!key) continue
    const list = byLocation.get(key) ?? []
    list.push(item)
    byLocation.set(key, list)
  }

  const items = rows.map((row) => {
    const siteContainers = byLocation.get(row.id) ?? []
    const mapped = displayContainers(
      siteContainers.map(item => mapContainerFromRow({
        ...item,
        boundary: row.boundary as GeoJsonPolygon | null,
        locationLatitude: row.latitude,
        locationLongitude: row.longitude,
      })),
      {
        latitude: row.latitude ? Number(row.latitude) : null,
        longitude: row.longitude ? Number(row.longitude) : null,
        mapHeading: row.mapHeading ?? 0,
        boundary: row.boundary as GeoJsonPolygon | null,
      },
    )
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      locationCode: row.locationCode,
      addressLine1: row.addressLine1,
      city: row.city,
      state: row.state,
      mainPhone: row.mainPhone,
      contactPhone: row.contactPhone,
      capacity: row.capacity,
      status: row.status,
      isUncategorized: row.isUncategorized,
      latitude: row.latitude ? Number(row.latitude) : null,
      longitude: row.longitude ? Number(row.longitude) : null,
      mapHeading: row.mapHeading ?? 0,
      boundary: row.boundary,
      hasBoundary: row.hasBoundary,
      occupancy: mapped.length,
      availableChassis: chassisByLocation.get(row.id) ?? 0,
      typeCounts: countContainersByType(mapped),
      containers: mapped,
    }
  })

  return { items }
})
