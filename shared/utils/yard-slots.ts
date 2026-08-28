/**
 * Suggested yard slots for containers that are on site but were never
 * pinned on the OpenStreetMap fence (drop-off without a place step,
 * or a map that failed to boot).
 */
import { equipmentFootprintMeters, type EquipmentType } from './domain'
import {
  bboxCenter,
  bboxFromPolygon,
  haversineMeters,
  normalizeHeading,
  offsetLatLng,
  pointInPolygon,
  rotateLocal,
  type GeoJsonPolygon,
} from './geo'

export interface SlotOrigin {
  latitude: number
  longitude: number
  heading: number
  boundary?: GeoJsonPolygon | null
}

export interface OccupiedSlot {
  latitude: number | null
  longitude: number | null
  equipmentType?: EquipmentType
  rotation?: number
}

/** Street runs left-to-right when the map bearing is streetHeading − 90. */
export function mapBearingFromStreetHeading(streetHeading: number): number {
  return normalizeHeading(streetHeading - 90)
}

/** Container long axis follows the street when the map is aligned. */
export function streetHeadingFromMapBearing(mapHeading: number): number {
  return normalizeHeading(mapHeading + 90)
}

export function isPlacedPin(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
): boolean {
  if (latitude == null || longitude == null) return false
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false
  return !(latitude === 0 && longitude === 0)
}

export function locationOrigin(location: {
  latitude?: number | null
  longitude?: number | null
  mapHeading?: number | null
  boundary?: GeoJsonPolygon | null
}): SlotOrigin | null {
  const box = bboxFromPolygon(location.boundary)
  const center = box
    ? bboxCenter(box)
    : (isPlacedPin(location.latitude ?? null, location.longitude ?? null)
        ? { latitude: location.latitude!, longitude: location.longitude! }
        : null)
  if (!center) return null
  return {
    latitude: center.latitude,
    longitude: center.longitude,
    heading: streetHeadingFromMapBearing(location.mapHeading ?? 0),
    boundary: location.boundary ?? null,
  }
}

export function slotAtIndex(
  origin: SlotOrigin,
  index: number,
  equipmentType: EquipmentType = 'HC_40',
): { latitude: number, longitude: number, rotation: number } {
  const size = equipmentFootprintMeters(equipmentType)
  const gap = 2.4
  const colPitch = size.width + gap
  const rowPitch = size.length + gap
  const cols = 3
  const col = index % cols
  const row = Math.floor(index / cols)
  const localEast = (col - 1) * colPitch
  const localNorth = (row + 0.55) * rowPitch
  const candidates = [1, 0.55, 0.25, 0].map((scale) => {
    const rotated = rotateLocal(localEast * scale, localNorth * scale, origin.heading)
    return offsetLatLng(origin.latitude, origin.longitude, rotated.east, rotated.north)
  })

  const pin = candidates.find(point =>
    !origin.boundary || pointInPolygon(point.latitude, point.longitude, origin.boundary),
  ) ?? { latitude: origin.latitude, longitude: origin.longitude }

  return {
    latitude: pin.latitude,
    longitude: pin.longitude,
    rotation: origin.heading,
  }
}

const MIN_SEPARATION_METERS = 4

function clashes(
  slot: { latitude: number, longitude: number },
  occupied: OccupiedSlot[],
): boolean {
  return occupied.some((item) => {
    if (!isPlacedPin(item.latitude, item.longitude)) return false
    return haversineMeters(item.latitude!, item.longitude!, slot.latitude, slot.longitude) < MIN_SEPARATION_METERS
  })
}

export function nextOpenSlot(
  origin: SlotOrigin,
  occupied: OccupiedSlot[],
  equipmentType: EquipmentType = 'HC_40',
): { latitude: number, longitude: number, rotation: number } {
  const taken = occupied.filter(item => isPlacedPin(item.latitude, item.longitude))
  for (let index = 0; index < 48; index++) {
    const slot = slotAtIndex(origin, index, equipmentType)
    if (!clashes(slot, taken)) return slot
  }
  return slotAtIndex(origin, taken.length, equipmentType)
}

export function hydrateUnplaced<T extends OccupiedSlot & { equipmentType: EquipmentType }>(
  items: T[],
  location: {
    latitude?: number | null
    longitude?: number | null
    mapHeading?: number | null
    boundary?: GeoJsonPolygon | null
  },
): Array<T & { suggested: boolean }> {
  const origin = locationOrigin(location)
  const occupied: OccupiedSlot[] = items.filter(item => isPlacedPin(item.latitude, item.longitude))
  return items.map((item) => {
    if (isPlacedPin(item.latitude, item.longitude)) {
      return { ...item, suggested: false }
    }
    if (!origin) {
      return { ...item, suggested: true }
    }
    const slot = nextOpenSlot(origin, occupied, item.equipmentType)
    occupied.push(slot)
    return {
      ...item,
      latitude: slot.latitude,
      longitude: slot.longitude,
      rotation: item.rotation || slot.rotation,
      suggested: true,
    }
  })
}
