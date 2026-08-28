import { and, eq, isNull } from 'drizzle-orm'
import { containerPlacements, containers, locations } from '../../database/schema'
import { assertTenant, requireAuth } from '../../utils/session'

/** One location plus the active-pool containers currently sitting there. */
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
    ))

  return {
    location: {
      id: location!.id,
      name: location!.name,
      type: location!.type,
      addressLine1: location!.addressLine1,
      city: location!.city,
      state: location!.state,
      capacity: location!.capacity,
    },
    containers: items,
  }
})
