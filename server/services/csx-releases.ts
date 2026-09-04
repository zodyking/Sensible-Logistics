import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { containers, csxPickupReleases, locations } from '../database/schema'
import type { DbExecutor } from '../utils/db'
import { locationIdsAtSameAddress } from './location-sites'
import { formatContainerNumber, normalizeContainerNumber } from '#shared/utils/iso6346'
import { claimCsxRelease, confirmCsxRelease, reopenCsxRelease } from '#shared/utils/csx-releases'

export interface NewCsxReleaseRow {
  containerNumber: string
  pickupNumber: string
  source?: 'MANUAL' | 'OCR'
}

export async function listOpenCsxReleases(
  db: DbExecutor,
  companyId: string,
  locationIds: string[],
) {
  if (!locationIds.length) return []
  return db
    .select()
    .from(csxPickupReleases)
    .where(and(
      eq(csxPickupReleases.companyId, companyId),
      inArray(csxPickupReleases.locationId, locationIds),
      eq(csxPickupReleases.status, 'OPEN'),
    ))
    .orderBy(csxPickupReleases.containerNumberNormalized)
}

export async function createCsxReleases(
  db: DbExecutor,
  input: {
    companyId: string
    locationId: string
    rows: NewCsxReleaseRow[]
  },
) {
  const created = []
  for (const row of input.rows) {
    const numberNormalized = normalizeContainerNumber(row.containerNumber)
    const pickupNumber = row.pickupNumber.trim()
    if (!numberNormalized || !pickupNumber) continue

    const [known] = await db
      .select({ id: containers.id, number: containers.number })
      .from(containers)
      .where(and(
        eq(containers.companyId, input.companyId),
        eq(containers.numberNormalized, numberNormalized),
      ))
      .limit(1)

    const [existing] = await db
      .select()
      .from(csxPickupReleases)
      .where(and(
        eq(csxPickupReleases.companyId, input.companyId),
        eq(csxPickupReleases.locationId, input.locationId),
        eq(csxPickupReleases.containerNumberNormalized, numberNormalized),
        inArray(csxPickupReleases.status, ['OPEN', 'CLAIMED']),
      ))
      .limit(1)

    if (existing) {
      const [updated] = await db
        .update(csxPickupReleases)
        .set({
          pickupNumber,
          containerId: known?.id ?? existing.containerId,
          source: row.source ?? existing.source,
          updatedAt: new Date(),
        })
        .where(eq(csxPickupReleases.id, existing.id))
        .returning()
      if (updated) created.push(updated)
      continue
    }

    const [inserted] = await db
      .insert(csxPickupReleases)
      .values({
        companyId: input.companyId,
        locationId: input.locationId,
        containerId: known?.id ?? null,
        containerNumber: formatContainerNumber(numberNormalized) || row.containerNumber.trim(),
        containerNumberNormalized: numberNormalized,
        pickupNumber,
        source: row.source ?? 'MANUAL',
        status: 'OPEN',
      })
      .returning()
    if (inserted) created.push(inserted)
  }
  return created
}

export async function cancelCsxRelease(
  db: DbExecutor,
  companyId: string,
  releaseId: string,
) {
  const [row] = await db
    .update(csxPickupReleases)
    .set({ status: 'CANCELLED', updatedAt: new Date(), claimedTripId: null })
    .where(and(
      eq(csxPickupReleases.id, releaseId),
      eq(csxPickupReleases.companyId, companyId),
      inArray(csxPickupReleases.status, ['OPEN', 'CLAIMED']),
    ))
    .returning()
  return row ?? null
}

async function siteIds(db: DbExecutor, companyId: string, locationId: string | null) {
  if (!locationId) return []
  return locationIdsAtSameAddress(db, companyId, locationId)
}

export async function claimCsxReleaseForTrip(
  db: DbExecutor,
  input: {
    companyId: string
    originLocationId: string | null
    containerNumber?: string | null
    containerId?: string | null
    tripId: string
  },
) {
  const numberNormalized = input.containerNumber
    ? normalizeContainerNumber(input.containerNumber)
    : ''
  const locationIds = await siteIds(db, input.companyId, input.originLocationId)
  if (!locationIds.length) return null

  const [row] = await db
    .select()
    .from(csxPickupReleases)
    .where(and(
      eq(csxPickupReleases.companyId, input.companyId),
      inArray(csxPickupReleases.locationId, locationIds),
      inArray(csxPickupReleases.status, ['OPEN', 'CLAIMED']),
      numberNormalized
        ? eq(csxPickupReleases.containerNumberNormalized, numberNormalized)
        : input.containerId
          ? eq(csxPickupReleases.containerId, input.containerId)
          : sql`false`,
    ))
    .limit(1)

  if (!row) return null
  const next = claimCsxRelease(row.status)
  if (!next) return row

  const [updated] = await db
    .update(csxPickupReleases)
    .set({
      status: next,
      claimedTripId: input.tripId,
      containerId: input.containerId ?? row.containerId,
      updatedAt: new Date(),
    })
    .where(eq(csxPickupReleases.id, row.id))
    .returning()
  return updated ?? row
}

export async function confirmCsxReleaseForTrip(
  db: DbExecutor,
  input: {
    companyId: string
    tripId: string
    originLocationId: string | null
    containerNumber?: string | null
    containerId?: string | null
  },
) {
  const numberNormalized = input.containerNumber
    ? normalizeContainerNumber(input.containerNumber)
    : ''
  const locationIds = await siteIds(db, input.companyId, input.originLocationId)

  const [byTrip] = await db
    .select()
    .from(csxPickupReleases)
    .where(and(
      eq(csxPickupReleases.companyId, input.companyId),
      eq(csxPickupReleases.claimedTripId, input.tripId),
      inArray(csxPickupReleases.status, ['OPEN', 'CLAIMED']),
    ))
    .limit(1)

  const [byNumber] = !byTrip && locationIds.length && (numberNormalized || input.containerId)
    ? await db
        .select()
        .from(csxPickupReleases)
        .where(and(
          eq(csxPickupReleases.companyId, input.companyId),
          inArray(csxPickupReleases.locationId, locationIds),
          inArray(csxPickupReleases.status, ['OPEN', 'CLAIMED']),
          numberNormalized
            ? eq(csxPickupReleases.containerNumberNormalized, numberNormalized)
            : eq(csxPickupReleases.containerId, input.containerId!),
        ))
        .limit(1)
    : []

  const row = byTrip ?? byNumber

  if (!row) return null
  const next = confirmCsxRelease(row.status)
  if (!next) return row

  const [updated] = await db
    .update(csxPickupReleases)
    .set({
      status: next,
      claimedTripId: input.tripId,
      pickedUpAt: new Date(),
      containerId: input.containerId ?? row.containerId,
      updatedAt: new Date(),
    })
    .where(eq(csxPickupReleases.id, row.id))
    .returning()
  return updated ?? row
}

export async function reopenCsxReleaseForTrip(
  db: DbExecutor,
  companyId: string,
  tripId: string,
) {
  const [row] = await db
    .select()
    .from(csxPickupReleases)
    .where(and(
      eq(csxPickupReleases.companyId, companyId),
      eq(csxPickupReleases.claimedTripId, tripId),
      eq(csxPickupReleases.status, 'CLAIMED'),
    ))
    .limit(1)

  if (!row) return null
  const next = reopenCsxRelease(row.status)
  if (!next) return row

  const [updated] = await db
    .update(csxPickupReleases)
    .set({
      status: next,
      claimedTripId: null,
      updatedAt: new Date(),
    })
    .where(eq(csxPickupReleases.id, row.id))
    .returning()
  return updated ?? row
}

export async function latestSnapshotsForContainers(
  db: DbExecutor,
  companyId: string,
  containerIds: string[],
) {
  if (!containerIds.length) return []
  const rows = await db
    .select()
    .from(csxShipmentSnapshots)
    .where(and(
      eq(csxShipmentSnapshots.companyId, companyId),
      inArray(csxShipmentSnapshots.containerId, containerIds),
    ))
    .orderBy(desc(csxShipmentSnapshots.checkedAt))

  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = row.containerId ?? row.containerNumberNormalized
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function assertTerminusLocation(
  db: DbExecutor,
  companyId: string,
  locationId: string,
) {
  const [location] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)))
    .limit(1)
  if (!location || location.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
  }
  if (location.type !== 'MARINE_TERMINAL' && location.type !== 'RAIL_TERMINAL') {
    throw createError({ statusCode: 409, statusMessage: 'CSX pickup lists are only for marine terminals and rail yards.' })
  }
  return location
}
