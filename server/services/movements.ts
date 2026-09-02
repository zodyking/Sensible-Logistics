import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import type { Database, DbExecutor } from '../utils/db'
import {
  chassis as chassisTable,
  containerEvents,
  containerPlacements,
  containers,
  drivers,
  locations,
  trips,
} from '../database/schema'
import type { Container, Location, Trip } from '../database/schema'
import { claimContainerForPickup, nextTripReference, releasePickupClaim } from './activePool'
import { eventExists, recordEvent } from './events'
import { resolvePlacement, writePlacement, type GeoPlacementInput } from './placements'
import type { AuthContext } from '../utils/session'
import { formatContainerNumber, normalizeContainerNumber } from '#shared/utils/iso6346'
import type { ContainerStatus, TripKind } from '#shared/utils/domain'
import {
  containerStatusAfterDropoff,
  dropoffCompletesServiceLife,
} from '#shared/utils/service-life'

/**
 * Driver-owned pickup and drop-off orchestration (spec 6.2, 6.3).
 *
 * Every function here runs the whole state change — events plus denormalised
 * container fields plus trip status — inside a single transaction, and accepts
 * a client-generated event id so weak-network retries are idempotent.
 */

/** Trip statuses in which a driver still owns the movement. */
export const LIVE_TRIP_STATUSES = ['PICKUP_IN_PROGRESS', 'IN_TRANSIT', 'DROPOFF_IN_PROGRESS'] as const

export interface StartPickupInput {
  eventId: string
  kind?: TripKind
  containerNumber?: string
  containerType?: Container['containerType']
  equipmentType?: Container['equipmentType']
  chassisId?: string | null
  originLocationId: string
  /** Empty inbound trip this load pickup is swapping against. */
  swapOfTripId?: string | null
  gps?: { latitude: number, longitude: number, accuracyMeters?: number } | null
}

export interface StartPickupResult {
  trip: Trip
  container: Container | null
  outcome: 'REUSE_ACTIVE' | 'REACTIVATE' | 'CREATE' | 'BARE_CHASSIS'
  replayed: boolean
}

/**
 * Activate a container and open a pickup-in-progress movement.
 *
 * This is the activation point described in spec 5.3: it happens as soon as the
 * driver confirms the identifier, before Confirm Pickup, so other drivers
 * immediately see the container is being worked.
 */
export async function startPickup(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: StartPickupInput,
): Promise<StartPickupResult> {
  if ((input.kind ?? 'CONTAINER') === 'BARE_CHASSIS') {
    return startBareChassisPickup(db, auth, input)
  }
  if (!input.containerNumber || !input.containerType) {
    throw createError({ statusCode: 422, statusMessage: 'Enter a container number.' })
  }
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const replayed = await loadTripByEvent(tx, auth.companyId, input.eventId)
      if (replayed) return { ...replayed, outcome: 'REUSE_ACTIVE' as const, replayed: true }
    }

    const numberNormalized = normalizeContainerNumber(input.containerNumber)
    const [known] = numberNormalized
      ? await tx
          .select()
          .from(containers)
          .where(and(
            eq(containers.companyId, auth.companyId),
            eq(containers.numberNormalized, numberNormalized),
          ))
          .limit(1)
      : []

    if (known) {
      const [liveForContainer] = await tx
        .select()
        .from(trips)
        .where(and(
          eq(trips.companyId, auth.companyId),
          eq(trips.containerId, known.id),
          inArray(trips.status, [...LIVE_TRIP_STATUSES]),
        ))
        .limit(1)

      if (liveForContainer) {
        if (liveForContainer.driverId !== auth.driverId) {
          throw createError({
            statusCode: 409,
            statusMessage: 'This container already has an active movement with another driver.',
          })
        }
        if (liveForContainer.status === 'PICKUP_IN_PROGRESS') {
          return {
            trip: liveForContainer,
            container: known,
            outcome: 'REUSE_ACTIVE',
            replayed: true,
          }
        }
        throw createError({
          statusCode: 409,
          statusMessage: 'This container is already on an active movement. Finish or cancel it before starting another pickup.',
          data: { tripId: liveForContainer.id, reference: liveForContainer.reference },
        })
      }
    }

    const swapSource = input.swapOfTripId
      ? await loadSwapSourceTrip(tx, auth, input.swapOfTripId, input.originLocationId)
      : null

    if (swapSource?.swapPairTripId) {
      const [pair] = await tx.select().from(trips).where(eq(trips.id, swapSource.swapPairTripId)).limit(1)
      if (pair && pair.status === 'PICKUP_IN_PROGRESS' && pair.driverId === auth.driverId) {
        const [pairContainer] = pair.containerId
          ? await tx.select().from(containers).where(eq(containers.id, pair.containerId)).limit(1)
          : []
        return {
          trip: pair,
          container: pairContainer ?? null,
          outcome: 'REUSE_ACTIVE',
          replayed: true,
        }
      }
      throw createError({
        statusCode: 409,
        statusMessage: 'A swap is already open for this trip.',
        data: { tripId: swapSource.swapPairTripId },
      })
    }

    const driverLive = await tx
      .select()
      .from(trips)
      .where(and(
        eq(trips.companyId, auth.companyId),
        eq(trips.driverId, auth.driverId),
        inArray(trips.status, [...LIVE_TRIP_STATUSES]),
      ))

    const extraLive = swapSource
      ? driverLive.filter(row => row.id !== swapSource.id)
      : driverLive

    if (extraLive[0]) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Finish or cancel your current movement before starting another pickup.',
        data: { tripId: extraLive[0].id, reference: extraLive[0].reference },
      })
    }

    const claim = await claimContainerForPickup(tx, {
      companyId: auth.companyId,
      driverId: auth.driverId,
      userId: auth.userId,
      rawNumber: input.containerNumber,
      containerType: input.containerType,
      equipmentType: input.equipmentType,
    })

    const previousState = claim.outcome === 'REACTIVATE' ? 'INACTIVE' : claim.container.activePoolState
    const previousContainerStatus = claim.container.containerStatus

    const reference = await nextTripReference(tx, auth.companyId)
    const [trip] = await tx
      .insert(trips)
      .values({
        companyId: auth.companyId,
        reference,
        driverId: auth.driverId,
        containerId: claim.container.id,
        originLocationId: input.originLocationId,
        status: 'PICKUP_IN_PROGRESS',
        kind: 'CONTAINER',
        isLoaded: Boolean(swapSource),
        swapPairTripId: swapSource?.id ?? null,
      })
      .returning()

    if (!trip) {
      throw createError({ statusCode: 500, statusMessage: 'Could not open the movement.' })
    }

    if (swapSource) {
      await tx
        .update(trips)
        .set({ swapPairTripId: trip.id, updatedAt: new Date() })
        .where(eq(trips.id, swapSource.id))
    }

    await recordEvent(
      tx,
      {
        id: input.eventId,
        companyId: auth.companyId,
        containerId: claim.container.id,
        eventType: 'PICKUP_STARTED',
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip.id,
        locationId: input.originLocationId,
        gps: input.gps,
        // Recorded so a cancellation can restore the exact prior pool state.
        payload: { previousState, previousContainerStatus, outcome: claim.outcome, reference },
      },
      { activeMovementId: trip.id },
    )

    const [container] = await tx.select().from(containers).where(eq(containers.id, claim.container.id)).limit(1)

    return { trip, container: container!, outcome: claim.outcome, replayed: false }
  })
}

async function assertNoLiveDriverTrip(
  tx: DbExecutor,
  auth: AuthContext & { driverId: string },
) {
  const [driverLive] = await tx
    .select()
    .from(trips)
    .where(and(
      eq(trips.companyId, auth.companyId),
      eq(trips.driverId, auth.driverId),
      inArray(trips.status, [...LIVE_TRIP_STATUSES]),
    ))
    .limit(1)

  if (driverLive) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Finish or cancel your current movement before starting another pickup.',
      data: { tripId: driverLive.id, reference: driverLive.reference },
    })
  }
}

async function startBareChassisPickup(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: StartPickupInput,
): Promise<StartPickupResult> {
  if (!input.chassisId) {
    throw createError({ statusCode: 422, statusMessage: 'Enter a chassis number.' })
  }

  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const replayed = await loadTripByEvent(tx, auth.companyId, input.eventId)
      if (replayed) return { ...replayed, outcome: 'BARE_CHASSIS' as const, replayed: true }
    }

    await assertNoLiveDriverTrip(tx, auth)
    await assertChassisAvailable(tx, auth.companyId, input.chassisId!, null)

    const [liveForChassis] = await tx
      .select()
      .from(trips)
      .where(and(
        eq(trips.companyId, auth.companyId),
        eq(trips.chassisId, input.chassisId!),
        inArray(trips.status, [...LIVE_TRIP_STATUSES]),
      ))
      .limit(1)

    if (liveForChassis) {
      if (liveForChassis.driverId === auth.driverId && liveForChassis.status === 'PICKUP_IN_PROGRESS') {
        return {
          trip: liveForChassis,
          container: null,
          outcome: 'BARE_CHASSIS',
          replayed: true,
        }
      }
      throw createError({
        statusCode: 409,
        statusMessage: 'That chassis is already on an active movement.',
        data: { tripId: liveForChassis.id, reference: liveForChassis.reference },
      })
    }

    const reference = await nextTripReference(tx, auth.companyId)
    const [trip] = await tx
      .insert(trips)
      .values({
        companyId: auth.companyId,
        reference,
        driverId: auth.driverId,
        containerId: null,
        chassisId: input.chassisId,
        originLocationId: input.originLocationId,
        status: 'PICKUP_IN_PROGRESS',
        kind: 'BARE_CHASSIS',
        isLoaded: false,
      })
      .returning()

    if (!trip) {
      throw createError({ statusCode: 500, statusMessage: 'Could not open the movement.' })
    }

    await recordEvent(tx, {
      id: input.eventId,
      companyId: auth.companyId,
      containerId: null,
      eventType: 'PICKUP_STARTED',
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      tripId: trip.id,
      locationId: input.originLocationId,
      chassisId: input.chassisId,
      gps: input.gps,
      payload: { kind: 'BARE_CHASSIS', reference },
    })

    await tx
      .update(chassisTable)
      .set({ status: 'IN_USE', updatedAt: new Date() })
      .where(and(eq(chassisTable.id, input.chassisId!), eq(chassisTable.companyId, auth.companyId)))

    return { trip, container: null, outcome: 'BARE_CHASSIS', replayed: false }
  })
}

export interface ConfirmPickupInput {
  eventId: string
  tripId: string
  chassisId?: string | null
  destinationLocationId?: string | null
  isLoaded: boolean
  sealNumber?: string | null
  notes?: string | null
  gps?: { latitude: number, longitude: number, accuracyMeters?: number } | null
}

function sealForLoadedContainer(isLoaded: boolean, sealNumber?: string | null): string | null {
  const seal = sealNumber?.trim() || null
  if (isLoaded && !seal) {
    throw createError({ statusCode: 422, statusMessage: 'Enter a seal number for a loaded container.' })
  }
  return isLoaded ? seal : null
}

/**
 * Confirm a pickup: the container moves into driver custody / in transit and
 * the authoritative pickup, chassis-attach and departure events are written.
 */
export async function confirmPickup(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: ConfirmPickupInput,
): Promise<{ trip: Trip, container: Container | null, replayed: boolean }> {
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const replayed = await loadTripByEvent(tx, auth.companyId, input.eventId)
      if (replayed) return { ...replayed, replayed: true }
    }

    const trip = await loadOwnedTrip(tx, auth, input.tripId)

    if (trip.status !== 'PICKUP_IN_PROGRESS') {
      throw createError({ statusCode: 409, statusMessage: 'This pickup has already been confirmed.' })
    }

    if (trip.kind === 'BARE_CHASSIS' || !trip.containerId) {
      return confirmBareChassisPickup(tx, auth, trip, input)
    }

    const [parked] = await tx.select().from(containers).where(eq(containers.id, trip.containerId)).limit(1)
    const chassisId = input.chassisId || trip.chassisId || parked?.currentChassisId || null
    const isLoaded = Boolean(trip.swapPairTripId) || input.isLoaded

    if (chassisId) {
      const mateContainerId = trip.swapPairTripId
        ? (await tx.select({ containerId: trips.containerId }).from(trips).where(eq(trips.id, trip.swapPairTripId)).limit(1))[0]?.containerId
        : null
      await assertChassisAvailable(tx, auth.companyId, chassisId, trip.containerId, mateContainerId)
    }

    const destinationLocationId = await resolvePickupDestination(
      tx,
      auth.companyId,
      trip,
      input.destinationLocationId,
    )

    const now = new Date()
    const sealNumber = sealForLoadedContainer(isLoaded, input.sealNumber)

    await recordEvent(
      tx,
      {
        id: input.eventId,
        companyId: auth.companyId,
        containerId: trip.containerId,
        eventType: 'PICKUP_CONFIRMED',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip.id,
        locationId: trip.originLocationId,
        chassisId: chassisId ?? null,
        gps: input.gps,
        payload: { isLoaded, sealNumber },
        notes: input.notes ?? null,
      },
      {
        activePoolState: 'DRIVER_CUSTODY',
        currentDriverId: auth.driverId,
        // In transit: the container is with the driver, not at a location.
        currentLocationId: null,
        currentChassisId: chassisId ?? null,
        activeMovementId: trip.id,
        isLoaded,
        sealNumber,
        containerStatus: 'IN_TRANSIT',
      },
    )

    if (chassisId) {
      await tx
        .update(chassisTable)
        .set({ currentContainerId: trip.containerId, status: 'IN_USE', updatedAt: now })
        .where(and(eq(chassisTable.id, chassisId), eq(chassisTable.companyId, auth.companyId)))
      await recordChassisHang(tx, auth, {
        containerId: trip.containerId,
        chassisId,
        tripId: trip.id,
        locationId: trip.originLocationId,
        kind: 'ATTACH',
        now,
      })
    }

    // The pickup vacates the origin slot, so any live placement is closed out.
    await tx
      .update(containerPlacements)
      .set({ supersededAt: now })
      .where(and(
        eq(containerPlacements.containerId, trip.containerId),
        eq(containerPlacements.companyId, auth.companyId),
        sql`${containerPlacements.supersededAt} is null`,
      ))

    const [updatedTrip] = await tx
      .update(trips)
      .set({
        status: 'IN_TRANSIT',
        chassisId: chassisId ?? null,
        destinationLocationId: destinationLocationId ?? trip.destinationLocationId,
        isLoaded,
        sealNumber,
        pickedUpAt: now,
        driverNotes: input.notes ?? trip.driverNotes,
        updatedAt: now,
        version: sql`${trips.version} + 1`,
      })
      .where(eq(trips.id, trip.id))
      .returning()

    await tx
      .update(drivers)
      .set({ status: 'ON_TRIP', updatedAt: now })
      .where(eq(drivers.id, auth.driverId))

    const [container] = await tx.select().from(containers).where(eq(containers.id, trip.containerId)).limit(1)

    return { trip: updatedTrip!, container: container!, replayed: false }
  })
}

async function confirmBareChassisPickup(
  tx: DbExecutor,
  auth: AuthContext & { driverId: string },
  trip: Trip,
  input: ConfirmPickupInput,
): Promise<{ trip: Trip, container: null, replayed: boolean }> {
  const chassisId = input.chassisId ?? trip.chassisId
  if (!chassisId) {
    throw createError({ statusCode: 422, statusMessage: 'Enter a chassis number.' })
  }

  await assertChassisAvailable(tx, auth.companyId, chassisId, null)
  const destinationLocationId = await resolvePickupDestination(
    tx,
    auth.companyId,
    trip,
    input.destinationLocationId,
  )
  const now = new Date()

  await recordEvent(tx, {
    id: input.eventId,
    companyId: auth.companyId,
    containerId: null,
    eventType: 'PICKUP_CONFIRMED',
    occurredAt: now,
    actorUserId: auth.userId,
    actorDriverId: auth.driverId,
    tripId: trip.id,
    locationId: trip.originLocationId,
    chassisId,
    gps: input.gps,
    payload: { kind: 'BARE_CHASSIS' },
    notes: input.notes ?? null,
  })

  await tx
    .update(chassisTable)
    .set({ status: 'IN_USE', currentContainerId: null, updatedAt: now })
    .where(and(eq(chassisTable.id, chassisId), eq(chassisTable.companyId, auth.companyId)))

  const [updatedTrip] = await tx
    .update(trips)
    .set({
      status: 'IN_TRANSIT',
      chassisId,
      destinationLocationId: destinationLocationId ?? trip.destinationLocationId,
      isLoaded: false,
      pickedUpAt: now,
      driverNotes: input.notes ?? trip.driverNotes,
      updatedAt: now,
      version: sql`${trips.version} + 1`,
    })
    .where(eq(trips.id, trip.id))
    .returning()

  await tx
    .update(drivers)
    .set({ status: 'ON_TRIP', updatedAt: now })
    .where(eq(drivers.id, auth.driverId))

  return { trip: updatedTrip!, container: null, replayed: false }
}

export interface CancelPickupInput {
  eventId: string
  tripId: string
  reason?: string | null
}

/**
 * Cancel the driver's live movement. Unconfirmed pickups drop the temporary
 * claim; in-transit / at-stop trips return the box to the origin yard and
 * leave the driver with no active trip. The trip row is deleted — cancelled
 * movements are not kept on Trips.
 */
export async function cancelPickup(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: CancelPickupInput,
): Promise<{ trip: Trip }> {
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const replayed = await loadTripByEvent(tx, auth.companyId, input.eventId)
      if (replayed?.trip.status === 'CANCELLED') {
        await discardTrip(tx, auth.companyId, replayed.trip.id)
      }
      if (replayed) return { trip: { ...replayed.trip, status: 'CANCELLED' } }
      return { trip: { id: input.tripId, companyId: auth.companyId, status: 'CANCELLED' } as Trip }
    }

    const trip = await loadOwnedTrip(tx, auth, input.tripId)

    if (!(LIVE_TRIP_STATUSES as readonly string[]).includes(trip.status)) {
      throw createError({ statusCode: 409, statusMessage: 'This movement is already finished.' })
    }

    const now = new Date()
    const restoreLocationId = trip.originLocationId

    if (!trip.containerId) {
      await recordEvent(tx, {
        id: input.eventId,
        companyId: auth.companyId,
        containerId: null,
        eventType: 'PICKUP_CANCELLED',
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip.id,
        locationId: restoreLocationId,
        chassisId: trip.chassisId,
        payload: { cancelledFrom: trip.status, kind: trip.kind },
        notes: input.reason ?? 'Driver cancelled the trip.',
      })

      if (trip.chassisId) {
        await tx
          .update(chassisTable)
          .set({
            currentContainerId: null,
            currentLocationId: restoreLocationId,
            status: 'AVAILABLE',
            updatedAt: now,
          })
          .where(and(eq(chassisTable.id, trip.chassisId), eq(chassisTable.companyId, auth.companyId)))
      }

      const snapshot: Trip = {
        ...trip,
        status: 'CANCELLED',
        cancelledAt: now,
        driverNotes: input.reason ?? trip.driverNotes,
        updatedAt: now,
      }
      await discardTrip(tx, auth.companyId, trip.id)

      await tx
        .update(drivers)
        .set({ status: 'AVAILABLE', updatedAt: now })
        .where(eq(drivers.id, auth.driverId))

      return { trip: snapshot }
    }

    const previous = await previousPickupState(tx, auth.companyId, trip.id)

    await recordEvent(tx, {
      id: input.eventId,
      companyId: auth.companyId,
      containerId: trip.containerId,
      eventType: 'PICKUP_CANCELLED',
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      tripId: trip.id,
      locationId: restoreLocationId,
      payload: {
        restoredState: previous.activePoolState,
        restoredContainerStatus: previous.containerStatus,
        cancelledFrom: trip.status,
      },
      notes: input.reason ?? 'Driver cancelled the trip.',
    }, trip.status === 'PICKUP_IN_PROGRESS'
      ? undefined
      : {
          activePoolState: previous.activePoolState === 'INACTIVE' ? 'AT_LOCATION' : previous.activePoolState,
          currentDriverId: null,
          currentLocationId: restoreLocationId,
          activeMovementId: null,
          currentChassisId: null,
          containerStatus: previous.containerStatus,
        })

    if (trip.status === 'PICKUP_IN_PROGRESS') {
      await releasePickupClaim(tx, auth.companyId, trip.containerId, previous.activePoolState, previous.containerStatus)
    }

    const [pair] = trip.swapPairTripId
      ? await tx.select().from(trips).where(eq(trips.id, trip.swapPairTripId)).limit(1)
      : []
    const pairLive = Boolean(
      pair && (LIVE_TRIP_STATUSES as readonly string[]).includes(pair.status),
    )

    if (trip.chassisId) {
      const giveBackToPair = Boolean(
        pairLive
        && pair?.chassisId === trip.chassisId
        && pair.containerId,
      )
      if (giveBackToPair && pair?.containerId) {
        await tx
          .update(chassisTable)
          .set({
            currentContainerId: pair.containerId,
            status: 'IN_USE',
            updatedAt: now,
          })
          .where(and(eq(chassisTable.id, trip.chassisId), eq(chassisTable.companyId, auth.companyId)))
      }
      else {
        await tx
          .update(chassisTable)
          .set({
            currentContainerId: null,
            currentLocationId: restoreLocationId,
            status: 'AVAILABLE',
            updatedAt: now,
          })
          .where(and(eq(chassisTable.id, trip.chassisId), eq(chassisTable.companyId, auth.companyId)))
      }
    }

    const snapshot: Trip = {
      ...trip,
      status: 'CANCELLED',
      cancelledAt: now,
      driverNotes: input.reason ?? trip.driverNotes,
      swapPairTripId: null,
      updatedAt: now,
    }
    await discardTrip(tx, auth.companyId, trip.id)

    const [otherLive] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(
        eq(trips.companyId, auth.companyId),
        eq(trips.driverId, auth.driverId),
        inArray(trips.status, [...LIVE_TRIP_STATUSES]),
      ))
      .limit(1)

    if (!otherLive) {
      await tx
        .update(drivers)
        .set({ status: 'AVAILABLE', updatedAt: now })
        .where(eq(drivers.id, auth.driverId))
    }

    return { trip: snapshot }
  })
}

export interface CompleteDropoffInput {
  eventId: string
  tripId: string
  destinationLocationId: string
  /** Geographic pin on the location's OpenStreetMap fence. */
  placement?: (GeoPlacementInput & { x?: number, y?: number, zoneId?: string | null, slotCode?: string | null }) | null
  retainChassis: boolean
  /**
   * Ignored by the server. A service life completes only when the drop-off
   * location is a marine terminal or rail yard.
   */
  isFinalRelease?: boolean
  notes?: string | null
  gps?: { latitude: number, longitude: number, accuracyMeters?: number } | null
}

/**
 * Complete a drop-off. The existing container is moved between active states
 * and locations — a second container record is never created (spec 5.3).
 */
export async function completeDropoff(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: CompleteDropoffInput,
): Promise<{ trip: Trip, container: Container | null, replayed: boolean, swapCompleted?: boolean }> {
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const replayed = await loadTripByEvent(tx, auth.companyId, input.eventId)
      if (replayed) return { ...replayed, replayed: true }
    }

    const trip = await loadOwnedTrip(tx, auth, input.tripId)

    if (!(['IN_TRANSIT', 'DROPOFF_IN_PROGRESS'] as string[]).includes(trip.status)) {
      throw createError({ statusCode: 409, statusMessage: 'This movement is not in transit.' })
    }

    if (!trip.containerId) {
      return completeBareChassisDropoff(tx, auth, trip, input)
    }

    const now = new Date()
    const detachChassis = Boolean(trip.chassisId) && !input.retainChassis
    const destination = await loadLocation(tx, auth.companyId, input.destinationLocationId)
    const isFinalRelease = dropoffCompletesServiceLife(destination.type)
    const containerStatus = containerStatusAfterDropoff(destination.type)

    await recordEvent(
      tx,
      {
        id: input.eventId,
        companyId: auth.companyId,
        containerId: trip.containerId,
        eventType: 'DROPOFF_CONFIRMED',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip.id,
        locationId: input.destinationLocationId,
        chassisId: input.retainChassis ? trip.chassisId : null,
        gps: input.gps,
        yardPosition: input.placement ?? null,
        payload: {
          isFinalRelease,
          retainChassis: input.retainChassis,
          locationType: destination.type,
          containerStatus,
        },
        notes: input.notes ?? null,
      },
      {
        activePoolState: isFinalRelease ? 'INACTIVE' : 'AT_LOCATION',
        currentDriverId: null,
        currentLocationId: input.destinationLocationId,
        activeMovementId: null,
        currentChassisId: input.retainChassis ? trip.chassisId : null,
        releasedAt: isFinalRelease ? now : null,
        containerStatus,
      },
    )

    if (detachChassis && trip.chassisId) {
      const [chassisRow] = await tx
        .select({ currentContainerId: chassisTable.currentContainerId })
        .from(chassisTable)
        .where(and(eq(chassisTable.id, trip.chassisId), eq(chassisTable.companyId, auth.companyId)))
        .limit(1)
      if (chassisRow?.currentContainerId && chassisRow.currentContainerId !== trip.containerId) {
        // Chassis already moved onto the swap load — leave it in use.
      }
      else {
        await tx
          .update(chassisTable)
          .set({
            currentContainerId: null,
            currentLocationId: input.destinationLocationId,
            status: 'AVAILABLE',
            updatedAt: now,
          })
          .where(and(eq(chassisTable.id, trip.chassisId), eq(chassisTable.companyId, auth.companyId)))
        await recordChassisHang(tx, auth, {
          containerId: trip.containerId,
          chassisId: trip.chassisId,
          tripId: trip.id,
          locationId: input.destinationLocationId,
          kind: 'DETACH',
          now,
        })
      }
    }

    if (isFinalRelease) {
      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: trip.containerId,
        eventType: 'RELEASED',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip.id,
        locationId: input.destinationLocationId,
        notes: 'Final release from the tracked network.',
      })
    }

    if (trip.containerId) {
      const occupied = await tx
        .select({
          latitude: containerPlacements.latitude,
          longitude: containerPlacements.longitude,
        })
        .from(containerPlacements)
        .where(and(
          eq(containerPlacements.locationId, destination.id),
          eq(containerPlacements.companyId, auth.companyId),
          sql`${containerPlacements.supersededAt} is null`,
        ))
      const [box] = await tx
        .select({ equipmentType: containers.equipmentType })
        .from(containers)
        .where(eq(containers.id, trip.containerId))
        .limit(1)
      const requested = input.placement && input.placement.latitude != null && input.placement.longitude != null
        ? {
            latitude: input.placement.latitude,
            longitude: input.placement.longitude,
            rotation: input.placement.rotation,
          }
        : null
      const placement = resolvePlacement(
        destination,
        occupied.map(row => ({
          latitude: row.latitude != null ? Number(row.latitude) : null,
          longitude: row.longitude != null ? Number(row.longitude) : null,
        })),
        box?.equipmentType ?? 'HC_40',
        requested,
      )
      if (placement) {
        await writePlacement(tx, auth, {
          containerId: trip.containerId,
          location: destination,
          placement,
          eventId: input.eventId,
        })
      }
    }

    const [updatedTrip] = await tx
      .update(trips)
      .set({
        status: 'COMPLETED',
        destinationLocationId: input.destinationLocationId,
        chassisId: input.retainChassis ? trip.chassisId : null,
        isFinalRelease,
        droppedOffAt: now,
        completedAt: now,
        driverNotes: input.notes ?? trip.driverNotes,
        updatedAt: now,
        version: sql`${trips.version} + 1`,
      })
      .where(eq(trips.id, trip.id))
      .returning()

    const [otherLive] = await tx
      .select({ id: trips.id })
      .from(trips)
      .where(and(
        eq(trips.companyId, auth.companyId),
        eq(trips.driverId, auth.driverId),
        inArray(trips.status, [...LIVE_TRIP_STATUSES]),
        ne(trips.id, trip.id),
      ))
      .limit(1)

    if (!otherLive) {
      await tx
        .update(drivers)
        .set({ status: 'AVAILABLE', updatedAt: now })
        .where(eq(drivers.id, auth.driverId))
    }

    const [container] = await tx.select().from(containers).where(eq(containers.id, trip.containerId)).limit(1)

    return {
      trip: updatedTrip!,
      container: container!,
      replayed: false,
      swapCompleted: Boolean(trip.swapPairTripId && otherLive),
    }
  })
}

async function completeBareChassisDropoff(
  tx: DbExecutor,
  auth: AuthContext & { driverId: string },
  trip: Trip,
  input: CompleteDropoffInput,
): Promise<{ trip: Trip, container: null, replayed: boolean }> {
  const now = new Date()
  const detachChassis = Boolean(trip.chassisId) && !input.retainChassis
  const destination = await loadLocation(tx, auth.companyId, input.destinationLocationId)
  const isFinalRelease = dropoffCompletesServiceLife(destination.type)

  await recordEvent(tx, {
    id: input.eventId,
    companyId: auth.companyId,
    containerId: null,
    eventType: 'DROPOFF_CONFIRMED',
    occurredAt: now,
    actorUserId: auth.userId,
    actorDriverId: auth.driverId,
    tripId: trip.id,
    locationId: input.destinationLocationId,
    chassisId: input.retainChassis ? trip.chassisId : null,
    gps: input.gps,
    payload: {
      kind: 'BARE_CHASSIS',
      retainChassis: input.retainChassis,
      locationType: destination.type,
      isFinalRelease,
    },
    notes: input.notes ?? null,
  })

  if (detachChassis && trip.chassisId) {
    await tx
      .update(chassisTable)
      .set({
        currentContainerId: null,
        currentLocationId: input.destinationLocationId,
        status: 'AVAILABLE',
        updatedAt: now,
      })
      .where(and(eq(chassisTable.id, trip.chassisId), eq(chassisTable.companyId, auth.companyId)))
  }

  const [updatedTrip] = await tx
    .update(trips)
    .set({
      status: 'COMPLETED',
      destinationLocationId: input.destinationLocationId,
      chassisId: input.retainChassis ? trip.chassisId : null,
      isFinalRelease,
      droppedOffAt: now,
      completedAt: now,
      driverNotes: input.notes ?? trip.driverNotes,
      updatedAt: now,
      version: sql`${trips.version} + 1`,
    })
    .where(eq(trips.id, trip.id))
    .returning()

  await tx
    .update(drivers)
    .set({ status: 'AVAILABLE', updatedAt: now })
    .where(eq(drivers.id, auth.driverId))

  return { trip: updatedTrip!, container: null, replayed: false }
}

export interface AttachContainerInput {
  eventId: string
  tripId: string
  containerNumber: string
  containerType: Container['containerType']
  equipmentType?: Container['equipmentType']
  isLoaded?: boolean
  sealNumber?: string | null
}

/**
 * Hang a container on an in-progress bare-chassis movement.
 */
export async function attachContainerToTrip(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: AttachContainerInput,
): Promise<StartPickupResult> {
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const replayed = await loadTripByEvent(tx, auth.companyId, input.eventId)
      if (replayed) return { ...replayed, outcome: 'REUSE_ACTIVE' as const, replayed: true }
    }

    const trip = await loadOwnedTrip(tx, auth, input.tripId)
    if (!(['IN_TRANSIT', 'DROPOFF_IN_PROGRESS'] as string[]).includes(trip.status)) {
      throw createError({ statusCode: 409, statusMessage: 'Confirm the chassis pickup before adding a container.' })
    }
    if (trip.containerId) {
      throw createError({ statusCode: 409, statusMessage: 'This movement already has a container.' })
    }
    if (!trip.chassisId) {
      throw createError({ statusCode: 422, statusMessage: 'This movement has no chassis to load onto.' })
    }

    const claim = await claimContainerForPickup(tx, {
      companyId: auth.companyId,
      driverId: auth.driverId,
      userId: auth.userId,
      rawNumber: input.containerNumber,
      containerType: input.containerType,
      equipmentType: input.equipmentType,
    })

    const now = new Date()
    const isLoaded = input.isLoaded ?? false
    const sealNumber = sealForLoadedContainer(isLoaded, input.sealNumber)

    await recordEvent(
      tx,
      {
        id: input.eventId,
        companyId: auth.companyId,
        containerId: claim.container.id,
        eventType: 'PICKUP_CONFIRMED',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip.id,
        chassisId: trip.chassisId,
        payload: {
          previousState: claim.container.activePoolState,
          previousContainerStatus: claim.container.containerStatus,
          attachedToBareChassis: true,
        },
      },
      {
        activePoolState: 'DRIVER_CUSTODY',
        currentDriverId: auth.driverId,
        currentLocationId: null,
        currentChassisId: trip.chassisId,
        activeMovementId: trip.id,
        isLoaded,
        sealNumber,
        containerStatus: 'IN_TRANSIT',
      },
    )

    await tx
      .update(chassisTable)
      .set({ currentContainerId: claim.container.id, status: 'IN_USE', updatedAt: now })
      .where(and(eq(chassisTable.id, trip.chassisId), eq(chassisTable.companyId, auth.companyId)))
    await recordChassisHang(tx, auth, {
      containerId: claim.container.id,
      chassisId: trip.chassisId,
      tripId: trip.id,
      locationId: trip.originLocationId,
      kind: 'ATTACH',
      now,
    })

    const [updatedTrip] = await tx
      .update(trips)
      .set({
        containerId: claim.container.id,
        kind: 'CONTAINER',
        isLoaded,
        sealNumber,
        updatedAt: now,
        version: sql`${trips.version} + 1`,
      })
      .where(eq(trips.id, trip.id))
      .returning()

    const [container] = await tx.select().from(containers).where(eq(containers.id, claim.container.id)).limit(1)
    return {
      trip: updatedTrip!,
      container: container!,
      outcome: claim.outcome,
      replayed: false,
    }
  })
}

/** Live movements the driver currently owns, oldest first (empty inbound before a swap load). */
export async function findActiveTrips(db: Database, companyId: string, driverId: string): Promise<Trip[]> {
  return db
    .select()
    .from(trips)
    .where(and(
      eq(trips.companyId, companyId),
      eq(trips.driverId, driverId),
      inArray(trips.status, [...LIVE_TRIP_STATUSES]),
    ))
    .orderBy(trips.createdAt)
}

/** The driver's current live movement, if any. */
export async function findActiveTrip(db: Database, companyId: string, driverId: string): Promise<Trip | null> {
  const [trip] = await findActiveTrips(db, companyId, driverId)
  return trip ?? null
}

/* ------------------------------------------------------------------ */

async function loadSwapSourceTrip(
  tx: DbExecutor,
  auth: AuthContext & { driverId: string },
  tripId: string,
  originLocationId: string,
): Promise<Trip> {
  const [source] = await tx
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.companyId, auth.companyId)))
    .limit(1)

  if (!source) {
    throw createError({ statusCode: 404, statusMessage: 'Movement not found.' })
  }
  if (source.driverId !== auth.driverId) {
    throw createError({ statusCode: 403, statusMessage: 'This movement belongs to another driver.' })
  }
  if (!(['IN_TRANSIT', 'DROPOFF_IN_PROGRESS'] as string[]).includes(source.status)) {
    throw createError({ statusCode: 409, statusMessage: 'Finish the empty inbound before starting a swap.' })
  }
  if (source.isLoaded || source.kind === 'BARE_CHASSIS') {
    throw createError({ statusCode: 409, statusMessage: 'A swap starts from an empty inbound to a customer.' })
  }
  if (!source.destinationLocationId) {
    throw createError({ statusCode: 409, statusMessage: 'Set a customer destination before swapping.' })
  }
  const destination = await loadLocation(tx, auth.companyId, source.destinationLocationId)
  if (destination.type !== 'CUSTOMER') {
    throw createError({ statusCode: 409, statusMessage: 'Swap is only available when heading to a customer location.' })
  }
  if (originLocationId !== source.destinationLocationId) {
    throw createError({ statusCode: 409, statusMessage: 'Pick up the load at the customer you are heading to.' })
  }
  return source
}

async function loadOwnedTrip(
  tx: DbExecutor,
  auth: AuthContext & { driverId: string },
  tripId: string,
): Promise<Trip> {
  const [trip] = await tx
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.companyId, auth.companyId)))
    .limit(1)

  if (!trip) {
    throw createError({ statusCode: 404, statusMessage: 'Movement not found.' })
  }
  if (trip.driverId !== auth.driverId) {
    throw createError({ statusCode: 403, statusMessage: 'This movement belongs to another driver.' })
  }
  return trip
}

/** Reads the pool and container status captured on PICKUP_STARTED so cancel can restore them. */
async function previousPickupState(
  tx: DbExecutor,
  companyId: string,
  tripId: string,
): Promise<{ activePoolState: Container['activePoolState'], containerStatus: ContainerStatus }> {
  const [event] = await tx
    .select({ payload: containerEvents.payload })
    .from(containerEvents)
    .where(and(
      eq(containerEvents.companyId, companyId),
      eq(containerEvents.tripId, tripId),
      eq(containerEvents.eventType, 'PICKUP_STARTED'),
    ))
    .limit(1)

  const previous = event?.payload?.previousState
  const previousStatus = event?.payload?.previousContainerStatus
  return {
    activePoolState: typeof previous === 'string' ? (previous as Container['activePoolState']) : 'INACTIVE',
    containerStatus: typeof previousStatus === 'string' ? (previousStatus as ContainerStatus) : 'AVAILABLE',
  }
}

async function resolvePickupDestination(
  tx: DbExecutor,
  companyId: string,
  trip: Trip,
  destinationLocationId: string | null | undefined,
): Promise<string | null> {
  const nextId = destinationLocationId ?? trip.destinationLocationId
  if (!nextId) return null
  if (nextId === trip.originLocationId) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Drop-off must be a different location from pickup.',
    })
  }
  await loadLocation(tx, companyId, nextId)
  return nextId
}

async function loadLocation(
  tx: DbExecutor,
  companyId: string,
  locationId: string,
): Promise<Location> {
  const [location] = await tx
    .select()
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.companyId, companyId)))
    .limit(1)

  if (!location) {
    throw createError({ statusCode: 404, statusMessage: 'Drop-off location not found.' })
  }
  return location
}

/** Drop a trip row. Child stops cascade; dispatch tasks lose the trip link. */
async function discardTrip(tx: DbExecutor, companyId: string, tripId: string) {
  const now = new Date()
  await tx
    .update(containers)
    .set({ activeMovementId: null, updatedAt: now })
    .where(and(eq(containers.companyId, companyId), eq(containers.activeMovementId, tripId)))
  await tx
    .update(trips)
    .set({ swapPairTripId: null, updatedAt: now })
    .where(eq(trips.swapPairTripId, tripId))
  await tx.delete(trips).where(and(eq(trips.id, tripId), eq(trips.companyId, companyId)))
}

/** Resolves the trip/container pair touched by an already-stored event id. */
async function loadTripByEvent(
  tx: DbExecutor,
  companyId: string,
  eventId: string,
): Promise<{ trip: Trip, container: Container | null } | null> {
  const [event] = await tx
    .select({ tripId: containerEvents.tripId, containerId: containerEvents.containerId })
    .from(containerEvents)
    .where(and(eq(containerEvents.id, eventId), eq(containerEvents.companyId, companyId)))
    .limit(1)

  if (!event?.tripId) return null

  const [trip] = await tx.select().from(trips).where(eq(trips.id, event.tripId)).limit(1)
  if (!trip) return null
  if (!event.containerId) return { trip, container: null }

  const [container] = await tx.select().from(containers).where(eq(containers.id, event.containerId)).limit(1)
  return { trip, container: container ?? null }
}

async function assertChassisAvailable(
  tx: DbExecutor,
  companyId: string,
  chassisId: string,
  containerId: string | null,
  alsoAllowContainerId?: string | null,
): Promise<void> {
  const [record] = await tx
    .select()
    .from(chassisTable)
    .where(and(eq(chassisTable.id, chassisId), eq(chassisTable.companyId, companyId)))
    .limit(1)

  if (!record) {
    throw createError({ statusCode: 404, statusMessage: 'Chassis not found.' })
  }
  if (record.outOfService) {
    throw createError({ statusCode: 409, statusMessage: `Chassis ${record.number} is flagged out of service.` })
  }
  if (
    record.currentContainerId
    && record.currentContainerId !== containerId
    && record.currentContainerId !== alsoAllowContainerId
  ) {
    const [box] = await tx
      .select({ number: containers.number, numberNormalized: containers.numberNormalized })
      .from(containers)
      .where(eq(containers.id, record.currentContainerId))
      .limit(1)
    const raw = box?.numberNormalized ?? box?.number ?? ''
    const label = formatContainerNumber(raw) || raw || 'another container'
    throw createError({
      statusCode: 409,
      statusMessage: `Chassis ${record.number} is already attached to container number ${label}.`,
      data: {
        currentContainerId: record.currentContainerId,
        currentContainerNumber: raw || null,
      },
    })
  }
}

async function recordChassisHang(
  tx: DbExecutor,
  auth: AuthContext,
  input: {
    containerId: string | null
    chassisId: string
    tripId?: string | null
    locationId?: string | null
    kind: 'ATTACH' | 'DETACH'
    now: Date
  },
): Promise<void> {
  await recordEvent(tx, {
    id: crypto.randomUUID(),
    companyId: auth.companyId,
    containerId: input.containerId,
    eventType: input.kind === 'ATTACH' ? 'CHASSIS_ATTACH' : 'CHASSIS_DETACH',
    occurredAt: input.now,
    actorUserId: auth.userId,
    actorDriverId: auth.driverId,
    tripId: input.tripId ?? null,
    locationId: input.locationId ?? null,
    chassisId: input.chassisId,
  })
}
