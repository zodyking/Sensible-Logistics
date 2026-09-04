import { and, desc, eq, sql } from 'drizzle-orm'
import type { DbExecutor } from '../utils/db'
import { containers, drivers, locations, trips, users } from '../database/schema'
import type { Container } from '../database/schema'
import { normalizeContainerNumber, validateContainerNumber } from '#shared/utils/iso6346'
import { resolutionReportsDriverHold } from '#shared/utils/driver-hold'

/**
 * Active container pool resolution (spec 5.3).
 *
 * A container's permanent identity is never duplicated. Entering a number on
 * the New Pickup screen resolves to exactly one of four outcomes:
 *
 *  - `REUSE_ACTIVE`  the container is already in the pool and unclaimed —
 *                    continue against the existing record
 *  - `REACTIVATE`    the number exists historically but is INACTIVE — the same
 *                    record re-enters the pool, preserving all prior history
 *  - `CREATE`        the number has never existed for this company
 *  - `CONFLICT`      another driver holds an active claim; a second pickup is
 *                    refused until the conflict is resolved
 */
export type ResolutionOutcome = 'REUSE_ACTIVE' | 'REACTIVATE' | 'CREATE' | 'CONFLICT'

export interface ConflictHolder {
  driverId: string
  driverName: string
  tripId: string | null
  tripReference: string | null
  activePoolState: string
  believedLocationId: string | null
  believedLocationName: string | null
  since: Date | null
}

export interface PoolResolution {
  outcome: ResolutionOutcome
  numberNormalized: string
  checkDigitValid: boolean
  validationErrors: string[]
  validationWarnings: string[]
  container: Container | null
  /** Populated when a driver currently holds the container. */
  holder: ConflictHolder | null
  /** Human-readable explanation shown on the resolution screen. */
  message: string
}

/** States in which another driver is actively working the container. */
const CLAIMED_STATES = ['PICKUP_IN_PROGRESS', 'DRIVER_CUSTODY'] as const

function isClaimed(container: Container): boolean {
  return (CLAIMED_STATES as readonly string[]).includes(container.activePoolState)
}

/**
 * Read-only preview of what starting a pickup for this number would do.
 * Performs no writes and takes no locks — the authoritative claim happens in
 * {@link claimContainerForPickup}.
 */
export async function previewResolution(
  db: DbExecutor,
  companyId: string,
  driverId: string,
  rawNumber: string,
): Promise<PoolResolution> {
  const validation = validateContainerNumber(rawNumber)
  const numberNormalized = validation.normalized

  const base = {
    numberNormalized,
    checkDigitValid: validation.checkDigitValid,
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
  }

  const [container] = await db
    .select()
    .from(containers)
    .where(and(eq(containers.companyId, companyId), eq(containers.numberNormalized, numberNormalized)))
    .limit(1)

  if (!container) {
    return {
      ...base,
      outcome: 'CREATE',
      container: null,
      holder: null,
      message: 'New to this company. A permanent container record will be created.',
    }
  }

  if (resolutionReportsDriverHold(container.activePoolState, {
    currentDriverId: container.currentDriverId,
    activeMovementId: container.activeMovementId,
  })) {
    const holder = await loadHolder(db, companyId, container)
    if (container.currentDriverId && container.currentDriverId !== driverId) {
      return {
        ...base,
        outcome: 'CONFLICT',
        container,
        holder,
        message: `${holder.driverName} currently has this container.`,
      }
    }
    return {
      ...base,
      outcome: 'REUSE_ACTIVE',
      container,
      holder,
      message: `${holder.driverName} currently holds this container.`,
    }
  }

  if (container.activePoolState === 'INACTIVE') {
    return {
      ...base,
      outcome: 'REACTIVATE',
      container,
      holder: null,
      message: 'Known container, currently inactive. Its existing history will be reused.',
    }
  }

  return {
    ...base,
    outcome: 'REUSE_ACTIVE',
    container,
    holder: null,
    message: 'Container is already in the active pool. Continuing against the existing record.',
  }
}

/** Resolve who currently holds a contested container, for the conflict screen. */
async function loadHolder(db: DbExecutor, companyId: string, container: Container): Promise<ConflictHolder> {
  let driverName = 'Another driver'
  let driverId = container.currentDriverId ?? ''
  let tripReference: string | null = null

  if (container.activeMovementId) {
    const [trip] = await db
      .select({ reference: trips.reference, driverId: trips.driverId })
      .from(trips)
      .where(eq(trips.id, container.activeMovementId))
      .limit(1)
    tripReference = trip?.reference ?? null
    if (!driverId && trip?.driverId) driverId = trip.driverId
  }

  if (driverId) {
    const [row] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(drivers)
      .innerJoin(users, eq(users.id, drivers.userId))
      .where(and(eq(drivers.id, driverId), eq(drivers.companyId, companyId)))
      .limit(1)
    if (row) driverName = `${row.firstName} ${row.lastName}`
  }

  let believedLocationName: string | null = null
  if (container.currentLocationId) {
    const [location] = await db
      .select({ name: locations.name })
      .from(locations)
      .where(eq(locations.id, container.currentLocationId))
      .limit(1)
    believedLocationName = location?.name ?? null
  }

  return {
    driverId,
    driverName,
    tripId: container.activeMovementId,
    tripReference,
    activePoolState: container.activePoolState,
    believedLocationId: container.currentLocationId,
    believedLocationName,
    since: container.lastActivityAt,
  }
}

export interface ClaimInput {
  companyId: string
  driverId: string
  userId: string
  rawNumber: string
  /** Required when the number is new to the company. */
  containerType: Container['containerType']
  equipmentType?: Container['equipmentType']
}

export interface ClaimResult {
  container: Container
  outcome: Exclude<ResolutionOutcome, 'CONFLICT'>
}

/**
 * Atomically claim a container for a pickup.
 *
 * Must be called inside a transaction. Existing rows are locked with
 * `SELECT … FOR UPDATE` and new rows rely on the per-company unique index on
 * the normalised number, so two drivers racing on the same container cannot
 * both obtain a valid claim (spec 5.3, 18).
 *
 * @throws 409 when another driver already holds the container
 * @throws 422 when the number is structurally invalid
 */
export async function claimContainerForPickup(tx: DbExecutor, input: ClaimInput): Promise<ClaimResult> {
  const validation = validateContainerNumber(input.rawNumber)
  const numberNormalized = validation.normalized

  if (!validation.structureValid) {
    throw createError({
      statusCode: 422,
      statusMessage: validation.errors[0] ?? 'Container number is not a valid ISO 6346 identifier.',
      data: { validation },
    })
  }

  const now = new Date()

  // Lock the existing identity, if any, for the remainder of the transaction.
  const [existing] = await tx
    .select()
    .from(containers)
    .where(and(eq(containers.companyId, input.companyId), eq(containers.numberNormalized, numberNormalized)))
    .limit(1)
    .for('update')

  if (existing) {
    if (isClaimed(existing) && existing.currentDriverId && existing.currentDriverId !== input.driverId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'This container is already claimed by another driver.',
        data: { holder: await loadHolder(tx, input.companyId, existing) },
      })
    }

    const outcome: Exclude<ResolutionOutcome, 'CONFLICT'>
      = existing.activePoolState === 'INACTIVE' ? 'REACTIVATE' : 'REUSE_ACTIVE'

    const [updated] = await tx
      .update(containers)
      .set({
        activePoolState: 'PICKUP_IN_PROGRESS',
        currentDriverId: input.driverId,
        // Reactivation restores the permanent identity to the pool without
        // clearing anything that describes where it was last seen.
        activatedAt: existing.activatedAt ?? now,
        releasedAt: null,
        lastActivityAt: now,
        updatedAt: now,
        version: sql`${containers.version} + 1`,
      })
      .where(eq(containers.id, existing.id))
      .returning()

    return { container: updated!, outcome }
  }

  // New identity. onConflictDoNothing + re-select closes the create/create race.
  const [inserted] = await tx
    .insert(containers)
    .values({
      companyId: input.companyId,
      number: validation.structureValid
        ? `${numberNormalized.slice(0, 4)} ${numberNormalized.slice(4, 10)}-${numberNormalized.slice(10)}`
        : numberNormalized,
      numberNormalized,
      checkDigitValid: validation.checkDigitValid,
      containerType: input.containerType,
      equipmentType: input.equipmentType ?? 'DRY_40',
      activePoolState: 'PICKUP_IN_PROGRESS',
      currentDriverId: input.driverId,
      activatedAt: now,
      lastActivityAt: now,
      createdByUserId: input.userId,
    })
    .onConflictDoNothing({ target: [containers.companyId, containers.numberNormalized] })
    .returning()

  if (inserted) {
    return { container: inserted, outcome: 'CREATE' }
  }

  // Another transaction won the insert — re-read and re-evaluate the claim.
  const [raced] = await tx
    .select()
    .from(containers)
    .where(and(eq(containers.companyId, input.companyId), eq(containers.numberNormalized, numberNormalized)))
    .limit(1)
    .for('update')

  if (!raced) {
    throw createError({ statusCode: 500, statusMessage: 'Could not resolve the container record.' })
  }

  if (raced.currentDriverId && raced.currentDriverId !== input.driverId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This container was just claimed by another driver.',
      data: { holder: await loadHolder(tx, input.companyId, raced) },
    })
  }

  return { container: raced, outcome: 'REUSE_ACTIVE' }
}

/**
 * Release a pickup-in-progress claim when the driver cancels before
 * confirming. A previously-inactive historical container returns to INACTIVE;
 * a container that was already established at a location keeps that state.
 */
export async function releasePickupClaim(
  tx: DbExecutor,
  companyId: string,
  containerId: string,
  previousState: Container['activePoolState'],
  previousContainerStatus?: Container['containerStatus'],
): Promise<void> {
  await tx
    .update(containers)
    .set({
      activePoolState: previousState,
      currentDriverId: null,
      activeMovementId: null,
      lastActivityAt: new Date(),
      updatedAt: new Date(),
      version: sql`${containers.version} + 1`,
      ...(previousContainerStatus ? { containerStatus: previousContainerStatus } : {}),
    })
    .where(and(eq(containers.id, containerId), eq(containers.companyId, companyId)))
}

/** Next human-readable trip reference for a company, e.g. `TRP-1043`. */
export async function nextTripReference(tx: DbExecutor, companyId: string): Promise<string> {
  const [row] = await tx
    .select({ reference: trips.reference })
    .from(trips)
    .where(eq(trips.companyId, companyId))
    .orderBy(desc(trips.createdAt))
    .limit(1)

  const lastNumber = Number(row?.reference?.replace(/\D/g, '') ?? 0)
  const next = Number.isFinite(lastNumber) && lastNumber > 0 ? lastNumber + 1 : 1001
  return `TRP-${next}`
}

/** Normalised form used for lookups that bypass full ISO validation. */
export function poolLookupKey(raw: string): string {
  return normalizeContainerNumber(raw)
}
