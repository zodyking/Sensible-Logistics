import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database, DbExecutor } from '../utils/db'
import {
  chassis,
  containerPlacements,
  containers,
  locations,
  trips,
} from '../database/schema'
import type { Container, Location } from '../database/schema'
import { eventExists, recordEvent } from './events'
import type { AuthContext } from '../utils/session'
import {
  formatChassisNumber,
  formatContainerNumber,
  isCompleteChassisNumber,
  normalizeChassisNumber,
  validateContainerNumber,
} from '#shared/utils/iso6346'
import { CONTAINER_TYPES, type ContainerType, type EquipmentType } from '#shared/utils/domain'
import { LOADED_SEAL_REQUIRED, missingLoadedSeal, sealForLoad } from '#shared/utils/seal'
import {
  bboxAround,
  bboxFromPolygon,
  latLngFromLocalMeters,
  localMetersFromLatLng,
  pointInPolygon,
  type GeoJsonPolygon,
} from '#shared/utils/geo'
import {
  hydrateUnplaced,
  isPlacedPin,
  locationOrigin,
  nextOpenSlot,
  type OccupiedSlot,
} from '#shared/utils/yard-slots'

export interface GeoPlacementInput {
  latitude: number
  longitude: number
  rotation: number
}

export interface MapContainer {
  id: string
  number: string
  numberNormalized: string | null
  containerType: ContainerType
  equipmentType: EquipmentType
  isLoaded: boolean
  latitude: number | null
  longitude: number | null
  rotation: number
  suggested?: boolean
  sealNumber?: string | null
  currentChassisId?: string | null
  chassisNumber?: string | null
}

function asNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function assertPlacementInside(location: Location, placement: GeoPlacementInput) {
  const boundary = location.boundary
  if (!boundary) return
  if (!pointInPolygon(placement.latitude, placement.longitude, boundary)) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Place the container inside the location fence.',
    })
  }
}

export function localXYFor(location: Location, placement: GeoPlacementInput): { x: number, y: number } {
  const box = bboxFromPolygon(location.boundary)
    ?? (asNumber(location.latitude) != null && asNumber(location.longitude) != null
      ? bboxAround(asNumber(location.latitude)!, asNumber(location.longitude)!, 80)
      : null)
  if (!box) return { x: 0, y: 0 }
  return localMetersFromLatLng(box, placement.latitude, placement.longitude)
}

async function loadLocation(tx: DbExecutor, auth: AuthContext, locationId: string): Promise<Location> {
  const [location] = await tx.select().from(locations).where(eq(locations.id, locationId)).limit(1)
  if (!location || location.companyId !== auth.companyId || location.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
  }
  return location
}

async function supersedeLivePlacement(tx: DbExecutor, companyId: string, containerId: string, at: Date) {
  await tx
    .update(containerPlacements)
    .set({ supersededAt: at })
    .where(and(
      eq(containerPlacements.containerId, containerId),
      eq(containerPlacements.companyId, companyId),
      sql`${containerPlacements.supersededAt} is null`,
    ))
}

export async function writePlacement(
  tx: DbExecutor,
  auth: AuthContext,
  input: {
    containerId: string
    location: Location
    placement: GeoPlacementInput
    eventId: string
  },
) {
  assertPlacementInside(input.location, input.placement)
  const now = new Date()
  const local = localXYFor(input.location, input.placement)
  await supersedeLivePlacement(tx, auth.companyId, input.containerId, now)
  await tx.insert(containerPlacements).values({
    companyId: auth.companyId,
    containerId: input.containerId,
    locationId: input.location.id,
    x: local.x,
    y: local.y,
    rotation: input.placement.rotation,
    latitude: String(input.placement.latitude),
    longitude: String(input.placement.longitude),
    eventId: input.eventId,
    placedByUserId: auth.userId,
  })
}

export async function moveContainerOnMap(
  db: Database,
  auth: AuthContext,
  input: {
    eventId: string
    locationId: string
    containerId: string
    placement: GeoPlacementInput
  },
): Promise<{ container: Container, replayed: boolean }> {
  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const [container] = await tx.select().from(containers).where(eq(containers.id, input.containerId)).limit(1)
      if (!container) throw createError({ statusCode: 404, statusMessage: 'Container not found.' })
      return { container, replayed: true }
    }

    const location = await loadLocation(tx, auth, input.locationId)
    const [container] = await tx.select().from(containers).where(eq(containers.id, input.containerId)).limit(1)
    if (!container || container.companyId !== auth.companyId) {
      throw createError({ statusCode: 404, statusMessage: 'Container not found.' })
    }
    if (container.currentLocationId !== location.id) {
      throw createError({ statusCode: 409, statusMessage: 'That container is not at this location.' })
    }

    await recordEvent(tx, {
      id: input.eventId,
      companyId: auth.companyId,
      containerId: container.id,
      eventType: 'YARD_MOVE',
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      locationId: location.id,
      source: auth.role === 'ADMIN' ? 'ADMIN_EDIT' : 'MANUAL',
      yardPosition: {
        latitude: input.placement.latitude,
        longitude: input.placement.longitude,
        rotation: input.placement.rotation,
      },
    })

    await writePlacement(tx, auth, {
      containerId: container.id,
      location,
      placement: input.placement,
      eventId: input.eventId,
    })

    return { container, replayed: false }
  })
}

export interface AddContainerAtLocationInput {
  eventId: string
  locationId: string
  containerNumber: string
  containerType: ContainerType
  equipmentType: EquipmentType
  isLoaded: boolean
  sealNumber?: string | null
  chassisNumber?: string | null
  placement?: GeoPlacementInput | null
}

async function findOrCreateChassis(
  tx: DbExecutor,
  auth: AuthContext,
  rawNumber: string,
) {
  if (!isCompleteChassisNumber(rawNumber)) {
    throw createError({
      statusCode: 422,
      statusMessage: 'A chassis number is four letters then six digits.',
    })
  }
  const numberNormalized = normalizeChassisNumber(rawNumber)
  const [existing] = await tx
    .select()
    .from(chassis)
    .where(and(
      eq(chassis.companyId, auth.companyId),
      eq(chassis.numberNormalized, numberNormalized),
      isNull(chassis.deletedAt),
    ))
    .limit(1)
    .for('update')

  if (existing) {
    if (existing.outOfService) {
      throw createError({
        statusCode: 409,
        statusMessage: `Chassis ${existing.number} is flagged out of service.`,
      })
    }
    return { unit: existing, created: false }
  }

  const [created] = await tx
    .insert(chassis)
    .values({
      companyId: auth.companyId,
      number: numberNormalized,
      numberNormalized,
      status: 'AVAILABLE',
    })
    .returning()
  return { unit: created!, created: true }
}

async function parkChassisAtLocation(
  tx: DbExecutor,
  auth: AuthContext,
  input: {
    unit: typeof chassis.$inferSelect
    locationId: string
    containerId: string | null
    now: Date
  },
) {
  if (input.unit.currentContainerId && input.unit.currentContainerId !== input.containerId) {
    const [box] = await tx
      .select({ number: containers.number, numberNormalized: containers.numberNormalized })
      .from(containers)
      .where(eq(containers.id, input.unit.currentContainerId))
      .limit(1)
    const raw = box?.numberNormalized ?? box?.number ?? ''
    const label = formatContainerNumber(raw) || raw || 'another container'
    throw createError({
      statusCode: 409,
      statusMessage: `That chassis is already attached to container number ${label}.`,
      data: {
        currentContainerId: input.unit.currentContainerId,
        currentContainerNumber: raw || null,
      },
    })
  }
  if (input.unit.status === 'IN_USE' && !input.containerId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'That chassis is on a live trip. Finish or cancel the movement first.',
    })
  }

  await tx
    .update(chassis)
    .set({
      currentContainerId: input.containerId,
      currentLocationId: input.locationId,
      status: 'AVAILABLE',
      updatedAt: input.now,
    })
    .where(and(eq(chassis.id, input.unit.id), eq(chassis.companyId, auth.companyId)))
}

const LIVE_ADD_TRIP_STATUSES = ['PICKUP_IN_PROGRESS', 'IN_TRANSIT', 'DROPOFF_IN_PROGRESS'] as const

/** Drop leftover live trips so an on-site add can record the box where it sits. */
async function closeLiveTripsForContainer(
  tx: DbExecutor,
  companyId: string,
  containerId: string,
) {
  const live = await tx
    .select({ id: trips.id })
    .from(trips)
    .where(and(
      eq(trips.companyId, companyId),
      eq(trips.containerId, containerId),
      inArray(trips.status, [...LIVE_ADD_TRIP_STATUSES]),
    ))

  const now = new Date()
  for (const trip of live) {
    await tx
      .update(containers)
      .set({ activeMovementId: null, updatedAt: now })
      .where(and(eq(containers.companyId, companyId), eq(containers.activeMovementId, trip.id)))
    await tx
      .update(trips)
      .set({ swapPairTripId: null, updatedAt: now })
      .where(eq(trips.swapPairTripId, trip.id))
    await tx
      .delete(trips)
      .where(and(eq(trips.id, trip.id), eq(trips.companyId, companyId)))
  }
}

async function followChassisWithContainer(
  tx: DbExecutor,
  auth: AuthContext,
  containerId: string,
  locationId: string,
  now: Date,
) {
  const [box] = await tx.select().from(containers).where(eq(containers.id, containerId)).limit(1)
  if (!box?.currentChassisId) return
  await tx
    .update(chassis)
    .set({
      currentContainerId: containerId,
      currentLocationId: locationId,
      status: 'AVAILABLE',
      updatedAt: now,
    })
    .where(and(eq(chassis.id, box.currentChassisId), eq(chassis.companyId, auth.companyId)))
}

/**
 * Record a container at a location without a trip — used when a box is
 * already on site. A map pin is written when the location has coordinates
 * or a fence; otherwise the box is still recorded on site, same as a
 * drop-off without a place step.
 */
export async function addContainerAtLocation(
  db: Database,
  auth: AuthContext,
  input: AddContainerAtLocationInput,
): Promise<{ container: Container, outcome: 'CREATE' | 'REACTIVATE' | 'MOVE', replayed: boolean }> {
  const validation = validateContainerNumber(input.containerNumber)
  if (!validation.structureValid) {
    throw createError({
      statusCode: 422,
      statusMessage: validation.errors[0] ?? 'Container number is not a valid ISO 6346 identifier.',
    })
  }
  const numberNormalized = validation.normalized

  return db.transaction(async (tx) => {
    if (await eventExists(tx, auth.companyId, input.eventId)) {
      const [existing] = await tx
        .select()
        .from(containers)
        .where(and(eq(containers.companyId, auth.companyId), eq(containers.numberNormalized, numberNormalized)))
        .limit(1)
      if (existing) return { container: existing, outcome: 'MOVE' as const, replayed: true }
    }

    const location = await loadLocation(tx, auth, input.locationId)
    const occupied = await tx
      .select({
        latitude: containerPlacements.latitude,
        longitude: containerPlacements.longitude,
      })
      .from(containerPlacements)
      .where(and(
        eq(containerPlacements.locationId, location.id),
        eq(containerPlacements.companyId, auth.companyId),
        sql`${containerPlacements.supersededAt} is null`,
      ))
    const placement = resolvePlacement(
      location,
      occupied.map(row => ({
        latitude: asNumber(row.latitude),
        longitude: asNumber(row.longitude),
      })),
      input.equipmentType,
      input.placement,
    )
    const now = new Date()
    const typedChassis = input.chassisNumber?.trim() || ''
    const reservedChassis = typedChassis
      ? (await findOrCreateChassis(tx, auth, typedChassis)).unit
      : null

    const [existing] = await tx
      .select()
      .from(containers)
      .where(and(eq(containers.companyId, auth.companyId), eq(containers.numberNormalized, numberNormalized)))
      .limit(1)
      .for('update')

    if (existing) {
      await closeLiveTripsForContainer(tx, auth.companyId, existing.id)
    }

    let container = existing
    let outcome: 'CREATE' | 'REACTIVATE' | 'MOVE' = 'MOVE'

    const sealNumber = sealForLoad(input.isLoaded, input.sealNumber ?? container?.sealNumber)
    if (missingLoadedSeal(input.isLoaded, sealNumber)) {
      throw createError({ statusCode: 422, statusMessage: LOADED_SEAL_REQUIRED })
    }

    if (!container) {
      const formatted = `${numberNormalized.slice(0, 4)} ${numberNormalized.slice(4, 10)}-${numberNormalized.slice(10)}`
      const [created] = await tx
        .insert(containers)
        .values({
          companyId: auth.companyId,
          number: formatted,
          numberNormalized,
          checkDigitValid: validation.checkDigitValid,
          containerType: input.containerType,
          equipmentType: input.equipmentType,
          isLoaded: input.isLoaded,
          sealNumber,
          activePoolState: 'AT_LOCATION',
          currentLocationId: location.id,
          activatedAt: now,
          lastActivityAt: now,
          createdByUserId: auth.userId,
        })
        .returning()
      container = created!
      outcome = 'CREATE'
    }
    else if (container.activePoolState === 'INACTIVE' || container.deletedAt) {
      outcome = 'REACTIVATE'
    }
    else if (container.currentLocationId !== location.id) {
      outcome = 'MOVE'
    }

    await recordEvent(
      tx,
      {
        id: input.eventId,
        companyId: auth.companyId,
        containerId: container.id,
        eventType: outcome === 'MOVE' && container.currentLocationId === location.id ? 'YARD_MOVE' : 'GATE_IN',
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        locationId: location.id,
        chassisId: reservedChassis?.id ?? container.currentChassisId ?? null,
        source: auth.role === 'ADMIN' ? 'ADMIN_EDIT' : 'MANUAL',
        yardPosition: placement
          ? {
              latitude: placement.latitude,
              longitude: placement.longitude,
              rotation: placement.rotation,
            }
          : null,
        payload: {
          outcome,
          chassisNumber: reservedChassis
            ? (formatChassisNumber(reservedChassis.number) || reservedChassis.number)
            : null,
          sealNumber,
        },
      },
      {
        activePoolState: 'AT_LOCATION',
        currentDriverId: null,
        currentLocationId: location.id,
        activeMovementId: null,
        isLoaded: input.isLoaded,
        sealNumber,
        deletedAt: null,
        currentChassisId: reservedChassis?.id ?? container.currentChassisId ?? null,
        activatedAt: container.activatedAt ?? now,
        releasedAt: null,
      },
    )

    if (outcome === 'CREATE' || outcome === 'REACTIVATE') {
      await recordEvent(tx, {
        id: crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: container.id,
        eventType: 'ACTIVATED',
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        locationId: location.id,
        source: auth.role === 'ADMIN' ? 'ADMIN_EDIT' : 'MANUAL',
      })
    }

    if (placement) {
      await writePlacement(tx, auth, {
        containerId: container.id,
        location,
        placement,
        eventId: input.eventId,
      })
    }

    if (reservedChassis) {
      if (container.currentChassisId && container.currentChassisId !== reservedChassis.id) {
        await tx
          .update(chassis)
          .set({ currentContainerId: null, status: 'AVAILABLE', updatedAt: now })
          .where(and(eq(chassis.id, container.currentChassisId), eq(chassis.companyId, auth.companyId)))
      }
      await parkChassisAtLocation(tx, auth, {
        unit: reservedChassis,
        locationId: location.id,
        containerId: container.id,
        now,
      })
    }
    else {
      await followChassisWithContainer(tx, auth, container.id, location.id, now)
    }

    const [updated] = await tx.select().from(containers).where(eq(containers.id, container.id)).limit(1)
    return { container: updated!, outcome, replayed: false }
  })
}

export async function addChassisAtLocation(
  db: Database,
  auth: AuthContext,
  input: { eventId: string, locationId: string, chassisNumber: string },
): Promise<{ chassis: typeof chassis.$inferSelect, created: boolean, replayed: boolean }> {
  return db.transaction(async (tx) => {
    const location = await loadLocation(tx, auth, input.locationId)
    const now = new Date()
    const { unit, created } = await findOrCreateChassis(tx, auth, input.chassisNumber)

    if (await eventExists(tx, auth.companyId, input.eventId)) {
      return { chassis: unit, created: false, replayed: true }
    }

    await parkChassisAtLocation(tx, auth, {
      unit,
      locationId: location.id,
      containerId: null,
      now,
    })

    await recordEvent(tx, {
      id: input.eventId,
      companyId: auth.companyId,
      eventType: 'GATE_IN',
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      locationId: location.id,
      chassisId: unit.id,
      source: auth.role === 'ADMIN' ? 'ADMIN_EDIT' : 'MANUAL',
      payload: {
        outcome: unit.currentLocationId === location.id ? 'PARK' : 'MOVE',
        chassisNumber: formatChassisNumber(unit.number) || unit.number,
      },
    })

    const [updated] = await tx.select().from(chassis).where(eq(chassis.id, unit.id)).limit(1)
    return { chassis: updated!, created, replayed: false }
  })
}

export async function moveContainerToLocation(
  db: Database,
  auth: AuthContext,
  input: { eventId: string, containerId: string, destinationLocationId: string },
): Promise<{ container: Container, outcome: 'CREATE' | 'REACTIVATE' | 'MOVE', replayed: boolean }> {
  const [container] = await db.select().from(containers).where(eq(containers.id, input.containerId)).limit(1)
  if (!container || container.companyId !== auth.companyId || container.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Container not found.' })
  }
  if (container.activePoolState === 'PICKUP_IN_PROGRESS' || container.activePoolState === 'DRIVER_CUSTODY') {
    throw createError({
      statusCode: 409,
      statusMessage: 'A driver currently holds this container. Finish or cancel that movement first.',
    })
  }
  if (container.doNotMove) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This container is flagged do not move.',
    })
  }
  if (!container.currentLocationId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This container is in transit. Arrive it before moving it between yards.',
    })
  }
  if (container.currentLocationId === input.destinationLocationId) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This container is already at that location.',
    })
  }

  let chassisNumber: string | null = null
  if (container.currentChassisId) {
    const [unit] = await db.select().from(chassis).where(eq(chassis.id, container.currentChassisId)).limit(1)
    chassisNumber = unit?.number ?? null
  }

  return addContainerAtLocation(db, auth, {
    eventId: input.eventId,
    locationId: input.destinationLocationId,
    containerNumber: container.number,
    containerType: container.containerType,
    equipmentType: container.equipmentType,
    isLoaded: container.isLoaded,
    sealNumber: container.sealNumber,
    chassisNumber,
  })
}

export function mapContainerFromRow(row: {
  id: string
  number: string
  numberNormalized: string | null
  containerType: string
  equipmentType: string
  isLoaded: boolean
  x: number | null
  y: number | null
  rotation: number | null
  latitude: string | number | null
  longitude: string | number | null
  locationLatitude?: string | number | null
  locationLongitude?: string | number | null
  boundary?: GeoJsonPolygon | null
  sealNumber?: string | null
  currentChassisId?: string | null
  chassisNumber?: string | null
}): MapContainer {
  const lat = asNumber(row.latitude)
  const lng = asNumber(row.longitude)
  let latitude = lat
  let longitude = lng

  if (latitude == null || longitude == null) {
    const box = bboxFromPolygon(row.boundary ?? null)
      ?? (asNumber(row.locationLatitude) != null && asNumber(row.locationLongitude) != null
        ? bboxAround(asNumber(row.locationLatitude)!, asNumber(row.locationLongitude)!, 80)
        : null)
    if (box && row.x != null && row.y != null && (row.x !== 0 || row.y !== 0)) {
      const recovered = latLngFromLocalMeters(box, row.x, row.y)
      latitude = recovered.latitude
      longitude = recovered.longitude
    }
  }

  const type = (CONTAINER_TYPES as readonly string[]).includes(row.containerType)
    ? row.containerType as ContainerType
    : 'CMA'

  return {
    id: row.id,
    number: row.number,
    numberNormalized: row.numberNormalized,
    containerType: type,
    equipmentType: row.equipmentType as EquipmentType,
    isLoaded: row.isLoaded,
    latitude,
    longitude,
    rotation: row.rotation ?? 0,
    suggested: false,
    sealNumber: row.sealNumber ?? null,
    currentChassisId: row.currentChassisId ?? null,
    chassisNumber: row.chassisNumber ?? null,
  }
}

export function displayContainers(
  containers: MapContainer[],
  location: {
    latitude?: number | null
    longitude?: number | null
    mapHeading?: number | null
    boundary?: GeoJsonPolygon | null
  },
): MapContainer[] {
  return hydrateUnplaced(containers, location)
}

export function resolvePlacement(
  location: Location,
  occupied: OccupiedSlot[],
  equipmentType: EquipmentType,
  requested?: GeoPlacementInput | null,
): GeoPlacementInput | null {
  if (requested && isPlacedPin(requested.latitude, requested.longitude)) {
    return requested
  }
  const origin = locationOrigin({
    latitude: asNumber(location.latitude),
    longitude: asNumber(location.longitude),
    mapHeading: location.mapHeading ?? 0,
    boundary: location.boundary,
  })
  if (!origin) return null
  return nextOpenSlot(origin, occupied, equipmentType)
}
