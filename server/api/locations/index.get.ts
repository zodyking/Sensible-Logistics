import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { containerPlacements, containers, locations } from '../../database/schema'
import { displayContainers, mapContainerFromRow } from '../../services/placements'
import { requireAuth } from '../../utils/session'
import { countContainersByType, LOCATION_TYPES } from '#shared/utils/domain'
import type { GeoJsonPolygon } from '#shared/utils/geo'

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  type: z.enum(LOCATION_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

/** Shared location pool with live occupancy, brand counts, and map placements. */
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

  const rows = await db
    .select({
      id: locations.id,
      name: locations.name,
      type: locations.type,
      addressLine1: locations.addressLine1,
      city: locations.city,
      state: locations.state,
      mainPhone: locations.mainPhone,
      contactPhone: locations.contactPhone,
      capacity: locations.capacity,
      status: locations.status,
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
        .where(and(
          eq(containers.companyId, auth.companyId),
          inArray(containers.currentLocationId, locationIds),
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
      addressLine1: row.addressLine1,
      city: row.city,
      state: row.state,
      mainPhone: row.mainPhone,
      contactPhone: row.contactPhone,
      capacity: row.capacity,
      status: row.status,
      latitude: row.latitude ? Number(row.latitude) : null,
      longitude: row.longitude ? Number(row.longitude) : null,
      mapHeading: row.mapHeading ?? 0,
      boundary: row.boundary,
      hasBoundary: row.hasBoundary,
      occupancy: mapped.length,
      typeCounts: countContainersByType(mapped),
      containers: mapped,
    }
  })

  return { items }
})
