import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Database, DbExecutor } from '../utils/db'
import {
  chassis as chassisTable,
  containerEvents,
  containerPlacements,
  containers,
  drivers,
  trips,
} from '../database/schema'
import type { Container, Trip } from '../database/schema'
import { claimContainerForPickup, nextTripReference, releasePickupClaim } from './activePool'
import { eventExists, recordEvent } from './events'
import type { AuthContext } from '../utils/session'

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
  containerNumber: string
  containerType: Container['containerType']
  equipmentType?: Container['equipmentType']
  originLocationId: string
  gps?: { latitude: number, longitude: number, accuracyMeters?: number } | null
}

export interface StartPickupResult {
  trip: Trip
  container: Container
  outcome: 'REUSE_ACTIVE' | 'REACTIVATE' | 'CREATE'
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
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const replayed = await loadTripByEvent(tx, auth.companyId, input.eventId)
      if (replayed) return { ...replayed, outcome: 'REUSE_ACTIVE' as const, replayed: true }
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
      })
      .returning()

    if (!trip) {
      throw createError({ statusCode: 500, statusMessage: 'Could not open the movement.' })
    }

    if (claim.outcome !== 'REUSE_ACTIVE') {
      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: claim.container.id,
        eventType: 'ACTIVATED',
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip.id,
        locationId: input.originLocationId,
        payload: { outcome: claim.outcome },
        notes: claim.outcome === 'REACTIVATE'
          ? 'Existing historical record returned to the active pool.'
          : 'New permanent container record created.',
      })
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
        payload: { previousState, outcome: claim.outcome, reference },
      },
      { activeMovementId: trip.id },
    )

    const [container] = await tx.select().from(containers).where(eq(containers.id, claim.container.id)).limit(1)

    return { trip, container: container!, outcome: claim.outcome, replayed: false }
  })
}

export interface ConfirmPickupInput {
  eventId: string
  tripId: string
  chassisId?: string | null
  isLoaded: boolean
  sealNumber?: string | null
  notes?: string | null
  gps?: { latitude: number, longitude: number, accuracyMeters?: number } | null
}

/**
 * Confirm a pickup: the container moves into driver custody / in transit and
 * the authoritative pickup, chassis-attach and departure events are written.
 */
export async function confirmPickup(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: ConfirmPickupInput,
): Promise<{ trip: Trip, container: Container, replayed: boolean }> {
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const replayed = await loadTripByEvent(tx, auth.companyId, input.eventId)
      if (replayed) return { ...replayed, replayed: true }
    }

    const trip = await loadOwnedTrip(tx, auth, input.tripId)

    if (trip.status !== 'PICKUP_IN_PROGRESS') {
      throw createError({ statusCode: 409, statusMessage: 'This pickup has already been confirmed.' })
    }
    if (!trip.containerId) {
      throw createError({ statusCode: 422, statusMessage: 'The movement has no container attached.' })
    }

    if (input.chassisId) {
      await assertChassisAvailable(tx, auth.companyId, input.chassisId, trip.containerId)
    }

    const now = new Date()

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
        chassisId: input.chassisId ?? null,
        gps: input.gps,
        payload: { isLoaded: input.isLoaded, sealNumber: input.sealNumber ?? null },
        notes: input.notes ?? null,
      },
      {
        activePoolState: 'DRIVER_CUSTODY',
        currentDriverId: auth.driverId,
        // In transit: the container is with the driver, not at a location.
        currentLocationId: null,
        currentChassisId: input.chassisId ?? null,
        activeMovementId: trip.id,
        isLoaded: input.isLoaded,
        sealNumber: input.sealNumber ?? null,
      },
    )

    if (input.chassisId) {
      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: trip.containerId,
        eventType: 'CHASSIS_ATTACH',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip.id,
        chassisId: input.chassisId,
      })

      await tx
        .update(chassisTable)
        .set({ currentContainerId: trip.containerId, status: 'IN_USE', updatedAt: now })
        .where(and(eq(chassisTable.id, input.chassisId), eq(chassisTable.companyId, auth.companyId)))
    }

    await recordEvent(tx, {
      id: crypto.randomUUID(),
      companyId: auth.companyId,
      containerId: trip.containerId,
      eventType: input.isLoaded ? 'LOADED' : 'EMPTIED',
      occurredAt: now,
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      tripId: trip.id,
    })

    await recordEvent(tx, {
      id: crypto.randomUUID(),
      companyId: auth.companyId,
      containerId: trip.containerId,
      eventType: 'DEPARTED',
      occurredAt: now,
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      tripId: trip.id,
      locationId: trip.originLocationId,
      gps: input.gps,
    })

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
        chassisId: input.chassisId ?? null,
        isLoaded: input.isLoaded,
        sealNumber: input.sealNumber ?? null,
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

export interface CancelPickupInput {
  eventId: string
  tripId: string
  reason?: string | null
}

/**
 * Abandon an unconfirmed pickup. The temporary claim is cleared while the
 * permanent identity and its audit trail are retained (spec 5.3).
 */
export async function cancelPickup(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: CancelPickupInput,
): Promise<{ trip: Trip }> {
  return db.transaction(async (tx) => {
    const trip = await loadOwnedTrip(tx, auth, input.tripId)

    if (trip.status !== 'PICKUP_IN_PROGRESS') {
      throw createError({ statusCode: 409, statusMessage: 'Only an unconfirmed pickup can be cancelled.' })
    }
    if (!trip.containerId) {
      throw createError({ statusCode: 422, statusMessage: 'The movement has no container attached.' })
    }

    const previousState = await previousPoolState(tx, auth.companyId, trip.id)

    await recordEvent(tx, {
      id: input.eventId,
      companyId: auth.companyId,
      containerId: trip.containerId,
      eventType: 'PICKUP_CANCELLED',
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      tripId: trip.id,
      payload: { restoredState: previousState },
      notes: input.reason ?? null,
    })

    await releasePickupClaim(tx, auth.companyId, trip.containerId, previousState)

    const [cancelled] = await tx
      .update(trips)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        driverNotes: input.reason ?? trip.driverNotes,
        updatedAt: new Date(),
        version: sql`${trips.version} + 1`,
      })
      .where(eq(trips.id, trip.id))
      .returning()

    return { trip: cancelled! }
  })
}

export interface CompleteDropoffInput {
  eventId: string
  tripId: string
  destinationLocationId: string
  /** Optional exact yard placement. TODO(Phase 2): Konva editor supplies these. */
  placement?: { x: number, y: number, rotation: number, zoneId?: string | null, slotCode?: string | null } | null
  retainChassis: boolean
  /** Removes the container from the active pool entirely. */
  isFinalRelease: boolean
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
): Promise<{ trip: Trip, container: Container, replayed: boolean }> {
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
      throw createError({ statusCode: 422, statusMessage: 'The movement has no container attached.' })
    }

    const now = new Date()
    const detachChassis = Boolean(trip.chassisId) && !input.retainChassis

    await recordEvent(tx, {
      id: crypto.randomUUID(),
      companyId: auth.companyId,
      containerId: trip.containerId,
      eventType: 'ARRIVED',
      occurredAt: now,
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      tripId: trip.id,
      locationId: input.destinationLocationId,
      gps: input.gps,
    })

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
        payload: { isFinalRelease: input.isFinalRelease, retainChassis: input.retainChassis },
        notes: input.notes ?? null,
      },
      {
        activePoolState: input.isFinalRelease ? 'INACTIVE' : 'AT_LOCATION',
        currentDriverId: null,
        currentLocationId: input.destinationLocationId,
        activeMovementId: null,
        currentChassisId: input.retainChassis ? trip.chassisId : null,
        releasedAt: input.isFinalRelease ? now : null,
      },
    )

    if (detachChassis && trip.chassisId) {
      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: trip.containerId,
        eventType: 'CHASSIS_DETACH',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip.id,
        chassisId: trip.chassisId,
      })

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

    if (input.isFinalRelease) {
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

    if (input.placement) {
      await tx
        .update(containerPlacements)
        .set({ supersededAt: now })
        .where(and(
          eq(containerPlacements.containerId, trip.containerId),
          eq(containerPlacements.companyId, auth.companyId),
          sql`${containerPlacements.supersededAt} is null`,
        ))

      await tx.insert(containerPlacements).values({
        companyId: auth.companyId,
        containerId: trip.containerId,
        locationId: input.destinationLocationId,
        zoneId: input.placement.zoneId ?? null,
        slotCode: input.placement.slotCode ?? null,
        x: input.placement.x,
        y: input.placement.y,
        rotation: input.placement.rotation,
        eventId: input.eventId,
        placedByUserId: auth.userId,
      })
    }

    const [updatedTrip] = await tx
      .update(trips)
      .set({
        status: 'COMPLETED',
        destinationLocationId: input.destinationLocationId,
        chassisId: input.retainChassis ? trip.chassisId : null,
        isFinalRelease: input.isFinalRelease,
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

    const [container] = await tx.select().from(containers).where(eq(containers.id, trip.containerId)).limit(1)

    return { trip: updatedTrip!, container: container!, replayed: false }
  })
}

/** The driver's current live movement, if any. */
export async function findActiveTrip(db: Database, companyId: string, driverId: string): Promise<Trip | null> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(
      eq(trips.companyId, companyId),
      eq(trips.driverId, driverId),
      inArray(trips.status, [...LIVE_TRIP_STATUSES]),
    ))
    .orderBy(desc(trips.createdAt))
    .limit(1)

  return trip ?? null
}

/* ------------------------------------------------------------------ */

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

/** Reads the pool state captured on PICKUP_STARTED so cancel can restore it. */
async function previousPoolState(
  tx: DbExecutor,
  companyId: string,
  tripId: string,
): Promise<Container['activePoolState']> {
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
  return typeof previous === 'string' ? (previous as Container['activePoolState']) : 'INACTIVE'
}

/** Resolves the trip/container pair touched by an already-stored event id. */
async function loadTripByEvent(
  tx: DbExecutor,
  companyId: string,
  eventId: string,
): Promise<{ trip: Trip, container: Container } | null> {
  const [event] = await tx
    .select({ tripId: containerEvents.tripId, containerId: containerEvents.containerId })
    .from(containerEvents)
    .where(and(eq(containerEvents.id, eventId), eq(containerEvents.companyId, companyId)))
    .limit(1)

  if (!event?.tripId) return null

  const [trip] = await tx.select().from(trips).where(eq(trips.id, event.tripId)).limit(1)
  const [container] = await tx.select().from(containers).where(eq(containers.id, event.containerId)).limit(1)

  return trip && container ? { trip, container } : null
}

async function assertChassisAvailable(
  tx: DbExecutor,
  companyId: string,
  chassisId: string,
  containerId: string,
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
  if (record.currentContainerId && record.currentContainerId !== containerId) {
    throw createError({ statusCode: 409, statusMessage: `Chassis ${record.number} is already carrying another container.` })
  }
}
