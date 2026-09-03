import { eq } from 'drizzle-orm'
import { locations, trips } from '../../../database/schema'
import { listOnSiteChassis, listOnSiteContainers } from '../../../services/location-equipment'
import { locationIdsAtSameAddress } from '../../../services/location-sites'
import { assertTenant, requireAuth } from '../../../utils/session'

/**
 * Equipment at the inbound empty's drop-off — same rows as that location's
 * equipment page. The load is picked up here; the empty still finishes at
 * this customer on Arrive. Nothing is sent back to the empty's origin.
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

  const [destination] = await db
    .select()
    .from(locations)
    .where(eq(locations.id, trip!.destinationLocationId))
    .limit(1)

  if (!destination) {
    throw createError({ statusCode: 404, statusMessage: 'Drop-off location not found.' })
  }

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
    containers: containerRows,
    chassis: chassisRows,
  }
})
