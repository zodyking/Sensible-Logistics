import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database, DbExecutor } from '../utils/db'
import {
  chassis,
  containerPlacements,
  containers,
  locations,
} from '../database/schema'
import type { Location } from '../database/schema'

export const UNCATEGORIZED_LOCATION_NAME = 'Uncategorized'

/** One holding yard per company for equipment whose site was deleted. */
export async function ensureUncategorizedLocation(
  db: Database | DbExecutor,
  companyId: string,
): Promise<Location> {
  const [existing] = await db
    .select()
    .from(locations)
    .where(and(
      eq(locations.companyId, companyId),
      eq(locations.isUncategorized, true),
      isNull(locations.deletedAt),
    ))
    .limit(1)

  if (existing) return existing

  const [created] = await db
    .insert(locations)
    .values({
      companyId,
      name: UNCATEGORIZED_LOCATION_NAME,
      type: 'COMPANY_YARD',
      isUncategorized: true,
      status: 'ACTIVE',
      country: 'US',
      latitude: '39.8283000',
      longitude: '-98.5795000',
      driverNotes: 'Holding location for equipment from deleted sites.',
    })
    .returning()

  if (created) return created

  const [race] = await db
    .select()
    .from(locations)
    .where(and(
      eq(locations.companyId, companyId),
      eq(locations.isUncategorized, true),
      isNull(locations.deletedAt),
    ))
    .limit(1)

  if (!race) {
    throw createError({ statusCode: 500, statusMessage: 'Could not create Uncategorized.' })
  }
  return race
}

export async function retireLocation(
  db: Database,
  companyId: string,
  locationId: string,
): Promise<{ uncategorizedLocationId: string, movedContainers: number, movedChassis: number }> {
  return db.transaction(async (tx) => {
    const [location] = await tx
      .select()
      .from(locations)
      .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)))
      .limit(1)

    if (!location || location.deletedAt) {
      throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
    }
    if (location.isUncategorized) {
      throw createError({ statusCode: 409, statusMessage: 'Uncategorized cannot be deleted.' })
    }

    const hold = await ensureUncategorizedLocation(tx, companyId)
    const now = new Date()

    const movedContainers = await tx
      .update(containers)
      .set({
        currentLocationId: hold.id,
        updatedAt: now,
      })
      .where(and(
        eq(containers.companyId, companyId),
        eq(containers.currentLocationId, locationId),
        isNull(containers.deletedAt),
      ))
      .returning({ id: containers.id })

    const movedChassis = await tx
      .update(chassis)
      .set({
        currentLocationId: hold.id,
        updatedAt: now,
      })
      .where(and(
        eq(chassis.companyId, companyId),
        eq(chassis.currentLocationId, locationId),
        isNull(chassis.deletedAt),
      ))
      .returning({ id: chassis.id })

    await tx
      .update(containerPlacements)
      .set({ supersededAt: now })
      .where(and(
        eq(containerPlacements.companyId, companyId),
        eq(containerPlacements.locationId, locationId),
        sql`${containerPlacements.supersededAt} is null`,
      ))

    await tx
      .update(locations)
      .set({
        deletedAt: now,
        status: 'ARCHIVED',
        updatedAt: now,
      })
      .where(eq(locations.id, locationId))

    return {
      uncategorizedLocationId: hold.id,
      movedContainers: movedContainers.length,
      movedChassis: movedChassis.length,
    }
  })
}
