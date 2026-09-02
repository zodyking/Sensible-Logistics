import { and, eq, isNull } from 'drizzle-orm'
import type { Database, DbExecutor } from '../utils/db'
import { locations } from '../database/schema'
import { locationIdsSharingAddress } from '#shared/utils/location-address'

/** Destination plus any other company sites that share that street address. */
export async function locationIdsAtSameAddress(
  db: Database | DbExecutor,
  companyId: string,
  locationId: string,
): Promise<string[]> {
  const catalog = await db
    .select({
      id: locations.id,
      normalizedAddress: locations.normalizedAddress,
      addressLine1: locations.addressLine1,
      city: locations.city,
      state: locations.state,
      postalCode: locations.postalCode,
    })
    .from(locations)
    .where(and(eq(locations.companyId, companyId), isNull(locations.deletedAt)))

  const site = catalog.find(row => row.id === locationId)
  if (!site) return [locationId]
  return locationIdsSharingAddress(site, catalog)
}
