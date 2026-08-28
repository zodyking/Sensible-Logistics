import { and, eq, isNull, sql } from 'drizzle-orm'
import { containerPlacements, containers, locations } from '../../database/schema'
import { mapContainerFromRow } from '../../services/placements'
import { assertTenant, requireAuth } from '../../utils/session'
import { countContainersByType, emptyTypeCounts } from '#shared/utils/domain'
import type { GeoJsonPolygon } from '#shared/utils/geo'

/** One location plus the active-pool containers currently sitting on its map. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }

  const db = useDb()

  const [location] = await db.select().from(locations).where(eq(locations.id, id)).limit(1)
  assertTenant(auth, location, 'Location')

  const items = await db
    .select({
      id: containers.id,
      number: containers.number,
      numberNormalized: containers.numberNormalized,
      equipmentType: containers.equipmentType,
      containerType: containers.containerType,
      isLoaded: containers.isLoaded,
      containerStatus: containers.containerStatus,
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
        eq(containerPlacements.locationId, id),
        isNull(containerPlacements.supersededAt),
      ),
    )
    .where(and(
      eq(containers.companyId, auth.companyId),
      eq(containers.currentLocationId, id),
      sql`${containers.activePoolState} <> 'INACTIVE'`,
    ))

  const mapped = items.map(item => mapContainerFromRow({
    ...item,
    boundary: location!.boundary as GeoJsonPolygon | null,
    locationLatitude: location!.latitude,
    locationLongitude: location!.longitude,
  }))

  return {
    location: {
      id: location!.id,
      name: location!.name,
      type: location!.type,
      addressLine1: location!.addressLine1,
      city: location!.city,
      state: location!.state,
      postalCode: location!.postalCode,
      capacity: location!.capacity,
      latitude: location!.latitude ? Number(location!.latitude) : null,
      longitude: location!.longitude ? Number(location!.longitude) : null,
      boundary: location!.boundary,
      hours: location!.hours,
      gateInstructions: location!.gateInstructions,
      driverNotes: location!.driverNotes,
    },
    typeCounts: mapped.length ? countContainersByType(mapped) : emptyTypeCounts(),
    occupancy: mapped.length,
    containers: mapped,
  }
})
