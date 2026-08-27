import { and, desc, eq, inArray, sql } from 'drizzle-orm'
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
import type { Container, Trip } from '../database/schema'
import { claimContainerForPickup, nextTripReference, releasePickupClaim } from './activePool'
import { eventExists, recordEvent } from './events'
import type { AuthContext } from '../utils/session'
import { normalizeContainerNumber } from '#shared/utils/iso6346'
import { documentChecklistForLocation } from '#shared/utils/workflow'
import type { LocationType } from '#shared/utils/domain'

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

    const hooked = await findConnectedContainer(tx, auth.companyId, auth.driverId)
    if (hooked) {
      throw createError({
        statusCode: 409,
        statusMessage: 'You are already connected to a container. Depart or swap it before starting a new pickup.',
        data: { containerId: hooked.id, number: hooked.number },
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
  /**
   * End-of-day hook: leave the box on the truck at this location. The trip
   * closes but the container stays `DRIVER_CUSTODY` with this driver so the
   * next morning shows “Connected to {name}” rather than a live move.
   */
  remainConnected?: boolean
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
    const remainConnected = Boolean(input.remainConnected) && !input.isFinalRelease
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
        payload: {
          isFinalRelease: input.isFinalRelease,
          retainChassis: input.retainChassis,
          remainConnected,
        },
        notes: input.notes ?? null,
      },
      {
        activePoolState: input.isFinalRelease
          ? 'INACTIVE'
          : remainConnected
            ? 'DRIVER_CUSTODY'
            : 'AT_LOCATION',
        currentDriverId: remainConnected ? auth.driverId : null,
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

/** Container this driver is hooked to while still sitting at a location. */
export async function findConnectedContainer(
  db: DbExecutor,
  companyId: string,
  driverId: string,
): Promise<Container | null> {
  const [row] = await db
    .select()
    .from(containers)
    .where(and(
      eq(containers.companyId, companyId),
      eq(containers.currentDriverId, driverId),
      eq(containers.activePoolState, 'DRIVER_CUSTODY'),
      sql`${containers.currentLocationId} is not null`,
    ))
    .orderBy(desc(containers.lastActivityAt))
    .limit(1)

  return row ?? null
}

export interface ConnectAtLocationInput {
  eventId: string
  containerId: string
  locationId: string
  chassisId?: string | null
  notes?: string | null
  gps?: { latitude: number, longitude: number, accuracyMeters?: number } | null
}

/**
 * Hook to a box that is already at a location. The container stays where it
 * is — no trip, no DEPARTED — so the dashboard shows Connected rather than
 * in transit. Overnight yard hook uses this same state.
 */
export async function connectAtLocation(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: ConnectAtLocationInput,
): Promise<{ container: Container, replayed: boolean }> {
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const [container] = await tx.select().from(containers).where(eq(containers.id, input.containerId)).limit(1)
      if (container) return { container, replayed: true }
    }

    await assertNoLiveTrip(tx, auth)

    const hooked = await findConnectedContainer(tx, auth.companyId, auth.driverId)
    if (hooked && hooked.id !== input.containerId) {
      throw createError({
        statusCode: 409,
        statusMessage: 'You are already connected to another container. Swap or drop it before hooking a different box.',
        data: { containerId: hooked.id, number: hooked.number },
      })
    }

    const [container] = await tx
      .select()
      .from(containers)
      .where(and(eq(containers.id, input.containerId), eq(containers.companyId, auth.companyId)))
      .limit(1)
      .for('update')

    if (!container) {
      throw createError({ statusCode: 404, statusMessage: 'Container not found.' })
    }

    if (container.currentDriverId && container.currentDriverId !== auth.driverId) {
      throw createError({ statusCode: 409, statusMessage: 'Another driver is already connected to this container.' })
    }

    if (container.activePoolState === 'DRIVER_CUSTODY' && container.currentDriverId === auth.driverId && container.currentLocationId === input.locationId) {
      return { container, replayed: true }
    }

    if (container.currentLocationId && container.currentLocationId !== input.locationId) {
      throw createError({ statusCode: 409, statusMessage: 'That container is not at this location.' })
    }

    if (!container.currentLocationId && container.activePoolState !== 'INACTIVE') {
      throw createError({ statusCode: 409, statusMessage: 'That container is already rolling. Arrive before connecting.' })
    }

    if (input.chassisId) {
      await assertChassisAvailable(tx, auth.companyId, input.chassisId, container.id)
    }

    const now = new Date()
    const chassisId = input.chassisId ?? container.currentChassisId

    if (container.activePoolState === 'INACTIVE') {
      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: container.id,
        eventType: 'ACTIVATED',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        locationId: input.locationId,
        notes: 'Returned to the active pool by connecting at the yard.',
      })
    }

    await recordEvent(
      tx,
      {
        id: input.eventId,
        companyId: auth.companyId,
        containerId: container.id,
        eventType: 'CONNECTED',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        locationId: input.locationId,
        chassisId,
        gps: input.gps,
        payload: { driverName: auth.fullName },
        notes: input.notes ?? `Connected to ${auth.fullName}`,
      },
      {
        activePoolState: 'DRIVER_CUSTODY',
        currentDriverId: auth.driverId,
        currentLocationId: input.locationId,
        currentChassisId: chassisId ?? null,
        activeMovementId: null,
        activatedAt: container.activatedAt ?? now,
        releasedAt: null,
      },
    )

    if (chassisId && chassisId !== container.currentChassisId) {
      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: container.id,
        eventType: 'CHASSIS_ATTACH',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        chassisId,
        locationId: input.locationId,
      })

      await tx
        .update(chassisTable)
        .set({ currentContainerId: container.id, currentLocationId: input.locationId, status: 'IN_USE', updatedAt: now })
        .where(and(eq(chassisTable.id, chassisId), eq(chassisTable.companyId, auth.companyId)))
    }

    await tx
      .update(drivers)
      .set({ status: 'AVAILABLE', updatedAt: now })
      .where(eq(drivers.id, auth.driverId))

    const [updated] = await tx.select().from(containers).where(eq(containers.id, container.id)).limit(1)
    return { container: updated!, replayed: false }
  })
}

export interface DepartConnectedInput {
  eventId: string
  destinationLocationId?: string | null
  notes?: string | null
  gps?: { latitude: number, longitude: number, accuracyMeters?: number } | null
}

/**
 * Leave the current location with the hooked container. This is the moment a
 * real move starts — origin stays on the trip, the box leaves the yard map.
 */
export async function departConnected(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: DepartConnectedInput,
): Promise<{ trip: Trip, container: Container, replayed: boolean }> {
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const replayed = await loadTripByEvent(tx, auth.companyId, input.eventId)
      if (replayed) return { ...replayed, replayed: true }
    }

    await assertNoLiveTrip(tx, auth)

    const hooked = await findConnectedContainer(tx, auth.companyId, auth.driverId)
    if (!hooked || !hooked.currentLocationId) {
      throw createError({ statusCode: 409, statusMessage: 'Connect to a container before departing.' })
    }

    const now = new Date()
    const originLocationId = hooked.currentLocationId
    const reference = await nextTripReference(tx, auth.companyId)

    const [trip] = await tx
      .insert(trips)
      .values({
        companyId: auth.companyId,
        reference,
        driverId: auth.driverId,
        containerId: hooked.id,
        chassisId: hooked.currentChassisId,
        originLocationId,
        destinationLocationId: input.destinationLocationId ?? null,
        status: 'IN_TRANSIT',
        isLoaded: hooked.isLoaded,
        sealNumber: hooked.sealNumber,
        pickedUpAt: now,
        driverNotes: input.notes ?? null,
      })
      .returning()

    if (!trip) {
      throw createError({ statusCode: 500, statusMessage: 'Could not open the movement.' })
    }

    await recordEvent(tx, {
      id: crypto.randomUUID(),
      companyId: auth.companyId,
      containerId: hooked.id,
      eventType: 'PICKUP_CONFIRMED',
      occurredAt: now,
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      tripId: trip.id,
      locationId: originLocationId,
      chassisId: hooked.currentChassisId,
      payload: { departedFromConnected: true },
    })

    await recordEvent(
      tx,
      {
        id: input.eventId,
        companyId: auth.companyId,
        containerId: hooked.id,
        eventType: 'DEPARTED',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip.id,
        locationId: originLocationId,
        gps: input.gps,
        notes: input.notes ?? null,
      },
      {
        activePoolState: 'DRIVER_CUSTODY',
        currentDriverId: auth.driverId,
        currentLocationId: null,
        activeMovementId: trip.id,
        currentChassisId: hooked.currentChassisId,
      },
    )

    await tx
      .update(containerPlacements)
      .set({ supersededAt: now })
      .where(and(
        eq(containerPlacements.containerId, hooked.id),
        eq(containerPlacements.companyId, auth.companyId),
        sql`${containerPlacements.supersededAt} is null`,
      ))

    await tx
      .update(drivers)
      .set({ status: 'ON_TRIP', updatedAt: now })
      .where(eq(drivers.id, auth.driverId))

    const [container] = await tx.select().from(containers).where(eq(containers.id, hooked.id)).limit(1)
    return { trip, container: container!, replayed: false }
  })
}

export interface ArriveAtLocationInput {
  eventId: string
  tripId: string
  locationId?: string | null
  notes?: string | null
  gps?: { latitude: number, longitude: number, accuracyMeters?: number } | null
}

/**
 * Mark arrival. The box is hooked at the stop so the driver can swap or drop
 * off — not yet a completed drop-off.
 */
export async function arriveAtLocation(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: ArriveAtLocationInput,
): Promise<{ trip: Trip, container: Container, replayed: boolean }> {
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const replayed = await loadTripByEvent(tx, auth.companyId, input.eventId)
      if (replayed) return { ...replayed, replayed: true }
    }

    const trip = await loadOwnedTrip(tx, auth, input.tripId)

    if (trip.status === 'DROPOFF_IN_PROGRESS') {
      const [container] = trip.containerId
        ? await tx.select().from(containers).where(eq(containers.id, trip.containerId)).limit(1)
        : []
      if (container) return { trip, container, replayed: true }
    }

    if (trip.status !== 'IN_TRANSIT') {
      throw createError({ statusCode: 409, statusMessage: 'Arrive is only available while you are in transit.' })
    }
    if (!trip.containerId) {
      throw createError({ statusCode: 422, statusMessage: 'The movement has no container attached.' })
    }

    const locationId = input.locationId ?? trip.destinationLocationId
    if (!locationId) {
      throw createError({ statusCode: 422, statusMessage: 'Choose the location you arrived at.' })
    }

    const now = new Date()

    await recordEvent(
      tx,
      {
        id: input.eventId,
        companyId: auth.companyId,
        containerId: trip.containerId,
        eventType: 'ARRIVED',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip.id,
        locationId,
        gps: input.gps,
        notes: input.notes ?? null,
      },
      {
        activePoolState: 'DRIVER_CUSTODY',
        currentDriverId: auth.driverId,
        currentLocationId: locationId,
        activeMovementId: trip.id,
      },
    )

    const [updatedTrip] = await tx
      .update(trips)
      .set({
        status: 'DROPOFF_IN_PROGRESS',
        destinationLocationId: locationId,
        updatedAt: now,
        version: sql`${trips.version} + 1`,
      })
      .where(eq(trips.id, trip.id))
      .returning()

    const [container] = await tx.select().from(containers).where(eq(containers.id, trip.containerId)).limit(1)
    return { trip: updatedTrip!, container: container!, replayed: false }
  })
}

export interface SwapAtLocationInput {
  eventId: string
  pickupContainerId: string
  locationId: string
  chassisId?: string | null
  notes?: string | null
  gps?: { latitude: number, longitude: number, accuracyMeters?: number } | null
}

export interface SwapResult {
  dropped: Container
  picked: Container
  trip: Trip | null
  locationType: LocationType
  requiredDocuments: string[]
  replayed: boolean
}

/**
 * Drop the hooked box and pick another at the same location in one motion.
 * Distinct from a drop-off: the driver leaves connected to the new container.
 */
export async function swapAtLocation(
  db: Database,
  auth: AuthContext & { driverId: string },
  input: SwapAtLocationInput,
): Promise<SwapResult> {
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      return loadSwapReplay(tx, auth, input)
    }

    const dropped = await findConnectedContainer(tx, auth.companyId, auth.driverId)
    if (!dropped) {
      throw createError({ statusCode: 409, statusMessage: 'Connect to a container before swapping.' })
    }
    if (dropped.currentLocationId !== input.locationId) {
      throw createError({ statusCode: 409, statusMessage: 'Arrive at this location before swapping.' })
    }
    if (dropped.id === input.pickupContainerId) {
      throw createError({ statusCode: 422, statusMessage: 'Pick a different container to swap onto.' })
    }

    const [picked] = await tx
      .select()
      .from(containers)
      .where(and(eq(containers.id, input.pickupContainerId), eq(containers.companyId, auth.companyId)))
      .limit(1)
      .for('update')

    if (!picked) {
      throw createError({ statusCode: 404, statusMessage: 'Pickup container not found.' })
    }
    if (picked.currentLocationId !== input.locationId) {
      throw createError({ statusCode: 409, statusMessage: 'The pickup container is not at this location.' })
    }
    if (picked.currentDriverId && picked.currentDriverId !== auth.driverId) {
      throw createError({ statusCode: 409, statusMessage: 'Another driver is already connected to that container.' })
    }
    if (picked.activePoolState === 'DRIVER_CUSTODY' && picked.currentDriverId === auth.driverId && picked.id !== dropped.id) {
      throw createError({ statusCode: 409, statusMessage: 'That container is already hooked to you.' })
    }

    const [location] = await tx
      .select({ id: locations.id, type: locations.type })
      .from(locations)
      .where(and(eq(locations.id, input.locationId), eq(locations.companyId, auth.companyId)))
      .limit(1)

    if (!location) {
      throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
    }

    const now = new Date()
    const liveTrip = await findActiveTrip(tx, auth.companyId, auth.driverId)
    const chassisId = input.chassisId ?? dropped.currentChassisId ?? picked.currentChassisId
    const requiredDocuments = documentChecklistForLocation(location.type)
      .filter(row => row.required)
      .map(row => row.category)

    if (input.chassisId && input.chassisId !== dropped.currentChassisId) {
      await assertChassisAvailable(tx, auth.companyId, input.chassisId, picked.id)
    }

    let trip: Trip | null = liveTrip

    if (liveTrip) {
      if (liveTrip.containerId !== dropped.id) {
        throw createError({ statusCode: 409, statusMessage: 'Your live movement is not carrying the connected container.' })
      }

      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: dropped.id,
        eventType: 'DROPOFF_CONFIRMED',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: liveTrip.id,
        locationId: input.locationId,
        gps: input.gps,
        payload: { swap: true, pickupContainerId: picked.id },
      }, {
        activePoolState: 'AT_LOCATION',
        currentDriverId: null,
        currentLocationId: input.locationId,
        activeMovementId: null,
        currentChassisId: chassisId && chassisId === dropped.currentChassisId ? null : dropped.currentChassisId,
      })

      const [updatedTrip] = await tx
        .update(trips)
        .set({
          status: 'COMPLETED',
          destinationLocationId: input.locationId,
          droppedOffAt: now,
          completedAt: now,
          requiredDocuments,
          driverNotes: input.notes ?? liveTrip.driverNotes,
          updatedAt: now,
          version: sql`${trips.version} + 1`,
        })
        .where(eq(trips.id, liveTrip.id))
        .returning()

      trip = updatedTrip ?? liveTrip
    }
    else {
      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: dropped.id,
        eventType: 'DROPOFF_CONFIRMED',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        locationId: input.locationId,
        gps: input.gps,
        payload: { swap: true, pickupContainerId: picked.id },
      }, {
        activePoolState: 'AT_LOCATION',
        currentDriverId: null,
        currentLocationId: input.locationId,
        activeMovementId: null,
        currentChassisId: chassisId && chassisId === dropped.currentChassisId ? null : dropped.currentChassisId,
      })
    }

    if (chassisId && dropped.currentChassisId === chassisId) {
      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: dropped.id,
        eventType: 'CHASSIS_DETACH',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip?.id ?? null,
        chassisId,
        locationId: input.locationId,
      })
    }

    if (picked.activePoolState === 'INACTIVE') {
      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: picked.id,
        eventType: 'ACTIVATED',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        locationId: input.locationId,
      })
    }

    await recordEvent(tx, {
      id: crypto.randomUUID(),
      companyId: auth.companyId,
      containerId: picked.id,
      eventType: 'CONNECTED',
      occurredAt: now,
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      tripId: trip?.id ?? null,
      locationId: input.locationId,
      chassisId,
      payload: { driverName: auth.fullName, swap: true },
      notes: `Connected to ${auth.fullName}`,
    }, {
      activePoolState: 'DRIVER_CUSTODY',
      currentDriverId: auth.driverId,
      currentLocationId: input.locationId,
      currentChassisId: chassisId ?? null,
      activeMovementId: null,
      activatedAt: picked.activatedAt ?? now,
      releasedAt: null,
    })

    await recordEvent(tx, {
      id: input.eventId,
      companyId: auth.companyId,
      containerId: picked.id,
      eventType: 'SWAPPED',
      occurredAt: now,
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      tripId: trip?.id ?? null,
      locationId: input.locationId,
      chassisId,
      gps: input.gps,
      payload: {
        droppedContainerId: dropped.id,
        droppedNumber: dropped.number,
        pickedContainerId: picked.id,
        pickedNumber: picked.number,
        requiredDocuments,
        driverName: auth.fullName,
      },
      notes: input.notes ?? `Dropped ${dropped.number}, picked ${picked.number}`,
    })

    await recordEvent(tx, {
      id: crypto.randomUUID(),
      companyId: auth.companyId,
      containerId: dropped.id,
      eventType: 'SWAPPED',
      occurredAt: now,
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      tripId: trip?.id ?? null,
      locationId: input.locationId,
      payload: {
        droppedContainerId: dropped.id,
        pickedContainerId: picked.id,
        counterpart: true,
      },
    })

    if (chassisId) {
      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: picked.id,
        eventType: 'CHASSIS_ATTACH',
        occurredAt: now,
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        tripId: trip?.id ?? null,
        chassisId,
        locationId: input.locationId,
      })

      await tx
        .update(chassisTable)
        .set({ currentContainerId: picked.id, currentLocationId: input.locationId, status: 'IN_USE', updatedAt: now })
        .where(and(eq(chassisTable.id, chassisId), eq(chassisTable.companyId, auth.companyId)))
    }

    await tx
      .update(drivers)
      .set({ status: 'AVAILABLE', updatedAt: now })
      .where(eq(drivers.id, auth.driverId))

    const [droppedRow] = await tx.select().from(containers).where(eq(containers.id, dropped.id)).limit(1)
    const [pickedRow] = await tx.select().from(containers).where(eq(containers.id, picked.id)).limit(1)

    return {
      dropped: droppedRow!,
      picked: pickedRow!,
      trip,
      locationType: location.type,
      requiredDocuments,
      replayed: false,
    }
  })
}

/** The driver's current live movement, if any. */
export async function findActiveTrip(db: DbExecutor, companyId: string, driverId: string): Promise<Trip | null> {
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

async function assertNoLiveTrip(
  tx: DbExecutor,
  auth: AuthContext & { driverId: string },
): Promise<void> {
  const live = await findActiveTrip(tx, auth.companyId, auth.driverId)
  if (live) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Finish or arrive on your current movement before connecting or departing from the yard.',
      data: { tripId: live.id, reference: live.reference },
    })
  }
}

async function loadSwapReplay(
  tx: DbExecutor,
  auth: AuthContext & { driverId: string },
  input: SwapAtLocationInput,
): Promise<SwapResult> {
  const [event] = await tx
    .select({
      tripId: containerEvents.tripId,
      containerId: containerEvents.containerId,
      payload: containerEvents.payload,
      locationId: containerEvents.locationId,
    })
    .from(containerEvents)
    .where(and(eq(containerEvents.id, input.eventId), eq(containerEvents.companyId, auth.companyId)))
    .limit(1)

  const droppedId = typeof event?.payload?.droppedContainerId === 'string' ? event.payload.droppedContainerId : null
  const pickedId = typeof event?.payload?.pickedContainerId === 'string'
    ? event.payload.pickedContainerId
    : event?.containerId ?? input.pickupContainerId

  const [dropped] = droppedId
    ? await tx.select().from(containers).where(eq(containers.id, droppedId)).limit(1)
    : []
  const [picked] = await tx.select().from(containers).where(eq(containers.id, pickedId)).limit(1)

  if (!dropped || !picked) {
    throw createError({ statusCode: 409, statusMessage: 'Could not replay the swap.' })
  }

  const [trip] = event?.tripId
    ? await tx.select().from(trips).where(eq(trips.id, event.tripId)).limit(1)
    : []

  const [location] = await tx
    .select({ type: locations.type })
    .from(locations)
    .where(eq(locations.id, input.locationId))
    .limit(1)

  const requiredDocuments = Array.isArray(event?.payload?.requiredDocuments)
    ? event.payload.requiredDocuments.filter((value): value is string => typeof value === 'string')
    : []

  return {
    dropped,
    picked,
    trip: trip ?? null,
    locationType: location?.type ?? 'COMPANY_YARD',
    requiredDocuments,
    replayed: true,
  }
}
