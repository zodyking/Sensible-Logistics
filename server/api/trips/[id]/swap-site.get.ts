import { eq, inArray } from 'drizzle-orm'
import { locations, trips } from '../../../database/schema'
import { listOnSiteChassis, listOnSiteContainers } from '../../../services/location-equipment'
import { locationIdsAtSameAddress } from '../../../services/location-sites'
import { assertTenant, requireAuth } from '../../../utils/session'

/**
 * The swap runs the empty's leg in reverse: the load is picked up at that
 * trip's drop-off and returns to where the empty came from. Containers are
 * the same rows as the drop-off location's equipment page, including empty
 * boxes and same-address twins.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Movement id is required.' })
  }

  const db = useDb()
  const [trip] = await db.select().from(trips).where(eq(trips.id, id)).limit(1)
  assertTenant(auth, trip, 'Movement')

  if (trip!.isLoaded || trip!.kind === 'BARE_CHASSIS') {
    throw createError({ statusCode: 409, statusMessage: 'Swap is only available on an empty inbound.' })
  }
  if (!trip!.destinationLocationId) {
    throw createError({ statusCode: 422, statusMessage: 'Set a drop-off on this trip before swapping.' })
  }

  const siteIds = [trip!.destinationLocationId, trip!.originLocationId].filter(Boolean) as string[]
  const sites = await db
    .select()
    .from(locations)
    .where(inArray(locations.id, siteIds))

  const destination = sites.find(row => row.id === trip!.destinationLocationId)
  if (!destination) {
    throw createError({ statusCode: 404, statusMessage: 'Drop-off location not found.' })
  }
  const returnTo = sites.find(row => row.id === trip!.originLocationId) ?? null

  const locationIds = await locationIdsAtSameAddress(db, auth.companyId, destination.id)
  const [containerRows, chassisRows] = await Promise.all([
    listOnSiteContainers(db, auth.companyId, locationIds, destination),
    listOnSiteChassis(db, auth.companyId, locationIds),
  ])

  return {
    destination: {
      id: destination.id,
      name: destination.name,
      type: destination.type,
      addressLine1: destination.addressLine1,
      city: destination.city,
    },
    returnTo: returnTo
      ? {
          id: returnTo.id,
          name: returnTo.name,
          type: returnTo.type,
          addressLine1: returnTo.addressLine1,
          city: returnTo.city,
        }
      : null,
    containers: containerRows,
    chassis: chassisRows,
  }
})
