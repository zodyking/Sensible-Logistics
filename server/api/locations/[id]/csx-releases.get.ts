import { and, eq, inArray } from 'drizzle-orm'
import { csxPickupReleases } from '../../../database/schema'
import { assertTerminusLocation, listOpenCsxReleases } from '../../../services/csx-releases'
import { locationIdsAtSameAddress } from '../../../services/location-sites'
import { requireAuth } from '../../../utils/session'

/** Open CSX empty-pickup releases at this marine/rail site. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })

  const db = useDb()
  await assertTerminusLocation(db, auth.companyId, id)
  const locationIds = await locationIdsAtSameAddress(db, auth.companyId, id)
  const open = await listOpenCsxReleases(db, auth.companyId, locationIds)
  const all = await db
    .select()
    .from(csxPickupReleases)
    .where(and(
      eq(csxPickupReleases.companyId, auth.companyId),
      inArray(csxPickupReleases.locationId, locationIds),
    ))
    .orderBy(csxPickupReleases.createdAt)

  return { releases: open, all }
})
