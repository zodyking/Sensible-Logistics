import { and, eq, sql } from 'drizzle-orm'
import type { Database, DbExecutor } from '../utils/db'
import {
  containerPlacements,
  containers,
  locations,
} from '../database/schema'
import type { Container, Location } from '../database/schema'
import { eventExists, recordEvent } from './events'
import type { AuthContext } from '../utils/session'
import { validateContainerNumber } from '#shared/utils/iso6346'
import { CONTAINER_TYPES, type ContainerType, type EquipmentType } from '#shared/utils/domain'
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
  placement?: GeoPlacementInput | null
}

/**
 * Drop a container onto a location map without a trip — used when a box is
 * already on site and just needs to be recorded on the fence.
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
      if (!existing) throw createError({ statusCode: 404, statusMessage: 'Container not found.' })
      return { container: existing, outcome: 'MOVE' as const, replayed: true }
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
    if (!placement) {
      throw createError({
        statusCode: 422,
        statusMessage: 'This location has no map pin yet. Edit the address before adding a container.',
      })
    }
    const now = new Date()

    const [existing] = await tx
      .select()
      .from(containers)
      .where(and(eq(containers.companyId, auth.companyId), eq(containers.numberNormalized, numberNormalized)))
      .limit(1)
      .for('update')

    if (existing && (existing.activePoolState === 'PICKUP_IN_PROGRESS' || existing.activePoolState === 'DRIVER_CUSTODY')) {
      throw createError({
        statusCode: 409,
        statusMessage: 'A driver currently holds this container. Finish or cancel that movement first.',
      })
    }

    let container = existing
    let outcome: 'CREATE' | 'REACTIVATE' | 'MOVE' = 'MOVE'

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
    else if (container.activePoolState === 'INACTIVE') {
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
        source: auth.role === 'ADMIN' ? 'ADMIN_EDIT' : 'MANUAL',
        yardPosition: {
          latitude: placement.latitude,
          longitude: placement.longitude,
          rotation: placement.rotation,
        },
        payload: { outcome },
      },
      {
        activePoolState: 'AT_LOCATION',
        currentDriverId: null,
        currentLocationId: location.id,
        activeMovementId: null,
        isLoaded: input.isLoaded,
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

    await writePlacement(tx, auth, {
      containerId: container.id,
      location,
      placement,
      eventId: input.eventId,
    })

    const [updated] = await tx.select().from(containers).where(eq(containers.id, container.id)).limit(1)
    return { container: updated!, outcome, replayed: false }
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
