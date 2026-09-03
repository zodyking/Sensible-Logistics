/**
 * Geographic helpers for location boundaries.
 *
 * Bounding boxes are west/south/east/north in WGS 84. Polygons are GeoJSON
 * (rings of [longitude, latitude]), matching `locations.boundary`.
 */

export interface BoundingBox {
  west: number
  south: number
  east: number
  north: number
}

export interface GeoJsonPolygon {
  type: 'Polygon'
  coordinates: [number, number][][]
}

const METERS_PER_DEG_LAT = 110540

function metersPerDegLon(latitude: number): number {
  return 111320 * Math.cos((latitude * Math.PI) / 180)
}

export function isValidBbox(box: BoundingBox): boolean {
  return box.west < box.east
    && box.south < box.north
    && box.west >= -180 && box.east <= 180
    && box.south >= -90 && box.north <= 90
}

/** Coerce API/database numeric strings into a finite WGS 84 component. */
export function parseCoord(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(n) ? n : null
}

/** Site pin. Rejects missing values, non-numeric strings, and the 0,0 placeholder. */
export function parsePin(
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined,
): { latitude: number, longitude: number } | null {
  const lat = parseCoord(latitude)
  const lng = parseCoord(longitude)
  if (lat == null || lng == null) return null
  if (lat === 0 && lng === 0) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { latitude: lat, longitude: lng }
}

/** Photon country codes and display names for United States results. */
export function isUnitedStatesCountry(value: string | null | undefined): boolean {
  const raw = String(value ?? '').trim().toUpperCase().replace(/\./g, '')
  if (!raw) return false
  return raw === 'US' || raw === 'USA' || raw === 'UNITED STATES' || raw === 'UNITED STATES OF AMERICA'
}

/** Photon/Nominatim extents arrive in mixed corner order — min/max is safer. */
export function bboxFromExtent(extent: number[]): BoundingBox | null {
  if (extent.length < 4) return null
  const [a, b, c, d] = extent
  if (![a, b, c, d].every(n => Number.isFinite(n))) return null
  const west = Math.min(a!, c!)
  const east = Math.max(a!, c!)
  const south = Math.min(b!, d!)
  const north = Math.max(b!, d!)
  const box = { west, south, east, north }
  return isValidBbox(box) ? box : null
}

export function bboxAround(latitude: number, longitude: number, halfMeters = 160): BoundingBox {
  const dLat = halfMeters / METERS_PER_DEG_LAT
  const dLon = halfMeters / Math.max(metersPerDegLon(latitude), 1)
  return {
    west: longitude - dLon,
    east: longitude + dLon,
    south: latitude - dLat,
    north: latitude + dLat,
  }
}

export function bboxSizeMeters(box: BoundingBox): { width: number, height: number } {
  const latMid = (box.north + box.south) / 2
  return {
    width: Math.abs(box.east - box.west) * Math.max(metersPerDegLon(latMid), 1),
    height: Math.abs(box.north - box.south) * METERS_PER_DEG_LAT,
  }
}

/** A usable yard is tens of metres to a few kilometres — not a city or a continent. */
export const MAX_YARD_FENCE_METERS = 8_000
export const MIN_YARD_FENCE_METERS = 8

export function isPlausibleYardFence(polygon: GeoJsonPolygon | null | undefined): boolean {
  const box = bboxFromPolygon(polygon)
  if (!box) return false
  const size = bboxSizeMeters(box)
  const longest = Math.max(size.width, size.height)
  const shortest = Math.min(size.width, size.height)
  return longest <= MAX_YARD_FENCE_METERS && shortest >= MIN_YARD_FENCE_METERS
}

export function polygonFromBbox(box: BoundingBox): GeoJsonPolygon {
  return {
    type: 'Polygon',
    coordinates: [[
      [box.west, box.south],
      [box.east, box.south],
      [box.east, box.north],
      [box.west, box.north],
      [box.west, box.south],
    ]],
  }
}

/**
 * Close an open ring of [longitude, latitude] vertices into a GeoJSON Polygon.
 * Returns null when there are fewer than three distinct corners.
 */
export function polygonFromRing(vertices: Array<[number, number]>): GeoJsonPolygon | null {
  if (vertices.length < 3) return null
  if (!vertices.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))) return null
  const ring: [number, number][] = vertices.map(([lng, lat]) => [lng, lat])
  const first = ring[0]!
  const last = ring[ring.length - 1]!
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]])
  }
  if (ring.length < 4) return null
  return { type: 'Polygon', coordinates: [ring] }
}

export function bboxFromPolygon(polygon: GeoJsonPolygon | null | undefined): BoundingBox | null {
  const ring = polygon?.coordinates?.[0]
  if (!ring?.length) return null
  const lons = ring.map(p => p[0])
  const lats = ring.map(p => p[1])
  const box = {
    west: Math.min(...lons),
    east: Math.max(...lons),
    south: Math.min(...lats),
    north: Math.max(...lats),
  }
  return isValidBbox(box) ? box : null
}

export function bboxCenter(box: BoundingBox): { latitude: number, longitude: number } {
  return {
    latitude: (box.north + box.south) / 2,
    longitude: (box.west + box.east) / 2,
  }
}

/** Local metres east/north of the south-west corner. */
export function localMetersFromLatLng(box: BoundingBox, latitude: number, longitude: number): { x: number, y: number } {
  const latMid = (box.north + box.south) / 2
  return {
    x: (longitude - box.west) * Math.max(metersPerDegLon(latMid), 1),
    y: (latitude - box.south) * METERS_PER_DEG_LAT,
  }
}

export function latLngFromLocalMeters(box: BoundingBox, x: number, y: number): { latitude: number, longitude: number } {
  const latMid = (box.north + box.south) / 2
  return {
    latitude: box.south + y / METERS_PER_DEG_LAT,
    longitude: box.west + x / Math.max(metersPerDegLon(latMid), 1),
  }
}

export function offsetLatLng(latitude: number, longitude: number, eastMeters: number, northMeters: number): { latitude: number, longitude: number } {
  return {
    latitude: latitude + northMeters / METERS_PER_DEG_LAT,
    longitude: longitude + eastMeters / Math.max(metersPerDegLon(latitude), 1),
  }
}

/** Clockwise heading in degrees from north, 0–360. */
export function normalizeHeading(degrees: number): number {
  const wrapped = degrees % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

export function headingDelta(a: number, b: number): number {
  const delta = Math.abs(normalizeHeading(a) - normalizeHeading(b))
  return Math.min(delta, 360 - delta)
}

/**
 * Rotate a local east/north offset so that +north becomes `headingDeg`
 * (container length points that way).
 */
export function rotateLocal(east: number, north: number, headingDeg: number): { east: number, north: number } {
  const rad = (headingDeg * Math.PI) / 180
  const sin = Math.sin(rad)
  const cos = Math.cos(rad)
  return {
    east: east * cos + north * sin,
    north: north * cos - east * sin,
  }
}

/** Four [lat, lng] corners of a container rectangle, length along heading. */
export function containerCorners(
  latitude: number,
  longitude: number,
  lengthMeters: number,
  widthMeters: number,
  headingDeg: number,
): [number, number][] {
  const halfL = lengthMeters / 2
  const halfW = widthMeters / 2
  const locals = [
    { east: -halfW, north: halfL },
    { east: halfW, north: halfL },
    { east: halfW, north: -halfL },
    { east: -halfW, north: -halfL },
  ]
  return locals.map((point) => {
    const rotated = rotateLocal(point.east, point.north, headingDeg)
    const latlng = offsetLatLng(latitude, longitude, rotated.east, rotated.north)
    return [latlng.latitude, latlng.longitude]
  })
}

/** Door-end edge as two [lat, lng] points (the heading-facing short side). */
export function containerDoorEdge(
  latitude: number,
  longitude: number,
  lengthMeters: number,
  widthMeters: number,
  headingDeg: number,
): [[number, number], [number, number]] {
  const corners = containerCorners(latitude, longitude, lengthMeters, widthMeters, headingDeg)
  return [corners[0]!, corners[1]!]
}

export function bearingDeg(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const φ1 = (fromLat * Math.PI) / 180
  const φ2 = (toLat * Math.PI) / 180
  const Δλ = ((toLng - fromLng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI)
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Pick the street heading or its reverse, whichever is closer to the current
 * rotation, so Align-to-street does not flip the door 180° unless needed.
 */
export function snapHeadingToStreet(current: number, street: number): number {
  const a = normalizeHeading(street)
  const b = normalizeHeading(street + 180)
  return headingDelta(current, a) <= headingDelta(current, b) ? a : b
}

/** Longest ring edge — a decent stand-in for street frontage on a drawn fence. */
export function longestEdgeBearing(polygon: GeoJsonPolygon | null | undefined): number | null {
  const ring = polygon?.coordinates?.[0]
  if (!ring || ring.length < 2) return null
  let best = { length: 0, bearing: 0 }
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!
    const b = ring[i + 1]!
    const length = haversineMeters(a[1], a[0], b[1], b[0])
    if (length > best.length) {
      best = { length, bearing: bearingDeg(a[1], a[0], b[1], b[0]) }
    }
  }
  return best.length > 0 ? best.bearing : null
}

export function pointInBbox(latitude: number, longitude: number, box: BoundingBox): boolean {
  return longitude >= box.west && longitude <= box.east && latitude >= box.south && latitude <= box.north
}

/** Ray-casting on a GeoJSON ring of [lng, lat] pairs. */
export function pointInPolygon(latitude: number, longitude: number, polygon: GeoJsonPolygon | null | undefined): boolean {
  const ring = polygon?.coordinates?.[0]
  if (!ring || ring.length < 4) return false
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]
    const yi = ring[i]![1]
    const xj = ring[j]![0]
    const yj = ring[j]![1]
    const intersect = ((yi > latitude) !== (yj > latitude))
      && (longitude < ((xj - xi) * (latitude - yi)) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

export function clampLatLngToBbox(latitude: number, longitude: number, box: BoundingBox): { latitude: number, longitude: number } {
  return {
    latitude: Math.min(box.north, Math.max(box.south, latitude)),
    longitude: Math.min(box.east, Math.max(box.west, longitude)),
  }
}
