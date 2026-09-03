import { eq } from 'drizzle-orm'
import { locations } from '../../database/schema'
import { listOnSiteChassis, listOnSiteContainers } from '../../services/location-equipment'
import { locationIdsAtSameAddress } from '../../services/location-sites'
import { assertTenant, requireAuth } from '../../utils/session'
import { countContainersByType, emptyTypeCounts } from '#shared/utils/domain'
import { parseCoord } from '#shared/utils/geo'

/** One location plus the active-pool containers currently sitting on its map. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  const query = getQuery(event)
  const sameAddress = query.sameAddress === '1' || query.sameAddress === 'true'

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }

  const db = useDb()

  const [location] = await db.select().from(locations).where(eq(locations.id, id)).limit(1)
  assertTenant(auth, location, 'Location')
  if (location!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
  }

  const locationIds = sameAddress
    ? await locationIdsAtSameAddress(db, auth.companyId, id)
    : [id]

  const mapped = await listOnSiteContainers(db, auth.companyId, locationIds, location!)
  const chassisRows = await listOnSiteChassis(db, auth.companyId, locationIds)

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
      latitude: parseCoord(location!.latitude),
      longitude: parseCoord(location!.longitude),
      mapHeading: location!.mapHeading ?? 0,
      boundary: location!.boundary,
      hours: location!.hours,
      mainPhone: location!.mainPhone,
      contactName: location!.contactName,
      contactPhone: location!.contactPhone,
      gateInstructions: location!.gateInstructions,
      driverNotes: location!.driverNotes,
      isUncategorized: location!.isUncategorized,
    },
    typeCounts: mapped.length ? countContainersByType(mapped) : emptyTypeCounts(),
    occupancy: mapped.length,
    containers: mapped,
    chassis: chassisRows,
  }
})
