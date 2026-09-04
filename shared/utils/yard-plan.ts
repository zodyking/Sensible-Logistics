/**
 * Local-metre yard plane used by the generated site plan and Konva view.
 *
 * Origin is the south-west corner of the buffered fence bbox. +x is east,
 * +y is north — the same convention as container_placements when a layout
 * is present. Features live in this plane so generation can be unit-tested
 * without GDAL.
 */

import {
  bboxFromPolygon,
  bboxSizeMeters,
  localMetersFromLatLng,
  latLngFromLocalMeters,
  type BoundingBox,
  type GeoJsonPolygon,
} from './geo'

export const YARD_BUFFER_METERS = 50
export const YARD_GENERATOR_VERSION = '2'
export const YARD_SIMPLIFY_METERS = 0.8

export const YARD_FEATURE_TYPES = [
  'PAVEMENT',
  'BUILDING',
  'ROAD',
  'DRIVEWAY',
  'RAIL',
  'FENCE',
  'GATE',
  'VEGETATION',
] as const
export type YardFeatureType = (typeof YARD_FEATURE_TYPES)[number]

export const YARD_FEATURE_SOURCES = ['OSM', 'ORTHO', 'MANUAL'] as const
export type YardFeatureSource = (typeof YARD_FEATURE_SOURCES)[number]

export type GeoJsonGeometry
  = | GeoJsonPolygon
    | { type: 'MultiPolygon', coordinates: [number, number][][][] }
    | { type: 'LineString', coordinates: [number, number][] }
    | { type: 'MultiLineString', coordinates: [number, number][][] }

export interface YardLayoutOrigin {
  originLng: number
  originLat: number
  planeWidth: number
  planeHeight: number
  rotationDeg: number
}

export interface YardFeatureDraft {
  type: YardFeatureType
  localGeometry: GeoJsonGeometry
  geoGeometry: GeoJsonGeometry
  source: YardFeatureSource
  confidence: number
  manuallyModified?: boolean
}

export interface YardSlotDraft {
  code: string
  type: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  manuallyModified?: boolean
}

const METERS_PER_DEG_LAT = 110540

function metersPerDegLon(latitude: number): number {
  return 111320 * Math.cos((latitude * Math.PI) / 180)
}

/** Expand a WGS 84 bbox by metres on every side. */
export function bufferBbox(box: BoundingBox, meters: number): BoundingBox {
  const latMid = (box.north + box.south) / 2
  const dLat = meters / METERS_PER_DEG_LAT
  const dLon = meters / Math.max(metersPerDegLon(latMid), 1)
  return {
    west: box.west - dLon,
    east: box.east + dLon,
    south: box.south - dLat,
    north: box.north + dLat,
  }
}

export function layoutOriginFromBox(box: BoundingBox, rotationDeg = 0): YardLayoutOrigin {
  const size = bboxSizeMeters(box)
  return {
    originLng: box.west,
    originLat: box.south,
    planeWidth: Math.max(24, size.width),
    planeHeight: Math.max(24, size.height),
    rotationDeg,
  }
}

export function originToBbox(origin: YardLayoutOrigin): BoundingBox {
  const dLat = origin.planeHeight / METERS_PER_DEG_LAT
  const dLon = origin.planeWidth / Math.max(metersPerDegLon(origin.originLat), 1)
  return {
    west: origin.originLng,
    east: origin.originLng + dLon,
    south: origin.originLat,
    north: origin.originLat + dLat,
  }
}

export function lngLatToLocal(
  origin: YardLayoutOrigin,
  latitude: number,
  longitude: number,
): { x: number, y: number } {
  return localMetersFromLatLng(originToBbox(origin), latitude, longitude)
}

export function localToLngLat(
  origin: YardLayoutOrigin,
  x: number,
  y: number,
): { latitude: number, longitude: number } {
  return latLngFromLocalMeters(originToBbox(origin), x, y)
}

function mapLngLatRing(
  ring: [number, number][],
  map: (lng: number, lat: number) => [number, number],
): [number, number][] {
  return ring.map(([lng, lat]) => map(lng, lat))
}

export function geometryToLocal(geometry: GeoJsonGeometry, origin: YardLayoutOrigin): GeoJsonGeometry {
  const map = (lng: number, lat: number): [number, number] => {
    const local = lngLatToLocal(origin, lat, lng)
    return [local.x, local.y]
  }
  return mapGeometry(geometry, map)
}

export function geometryToGeo(geometry: GeoJsonGeometry, origin: YardLayoutOrigin): GeoJsonGeometry {
  const map = (x: number, y: number): [number, number] => {
    const geo = localToLngLat(origin, x, y)
    return [geo.longitude, geo.latitude]
  }
  return mapGeometry(geometry, map)
}

function mapGeometry(
  geometry: GeoJsonGeometry,
  map: (a: number, b: number) => [number, number],
): GeoJsonGeometry {
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(ring => mapLngLatRing(ring, map)) }
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map(poly => poly.map(ring => mapLngLatRing(ring, map))),
    }
  }
  if (geometry.type === 'LineString') {
    return { type: 'LineString', coordinates: mapLngLatRing(geometry.coordinates, map) }
  }
  return {
    type: 'MultiLineString',
    coordinates: geometry.coordinates.map(line => mapLngLatRing(line, map)),
  }
}

function pointDistance(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return Math.hypot(dx, dy)
}

function pointLineDistance(point: [number, number], start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const length2 = dx * dx + dy * dy
  if (length2 === 0) return pointDistance(point, start)
  let t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2
  t = Math.max(0, Math.min(1, t))
  return pointDistance(point, [start[0] + t * dx, start[1] + t * dy])
}

/** Ramer–Douglas–Peucker on a ring or line of [x, y] metres. */
export function simplifyLine(points: [number, number][], epsilon = YARD_SIMPLIFY_METERS): [number, number][] {
  if (points.length < 3) return points
  let maxDist = 0
  let index = 0
  const end = points.length - 1
  for (let i = 1; i < end; i++) {
    const dist = pointLineDistance(points[i]!, points[0]!, points[end]!)
    if (dist > maxDist) {
      index = i
      maxDist = dist
    }
  }
  if (maxDist > epsilon) {
    const left = simplifyLine(points.slice(0, index + 1), epsilon)
    const right = simplifyLine(points.slice(index), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [points[0]!, points[end]!]
}

export function simplifyGeometry(geometry: GeoJsonGeometry, epsilon = YARD_SIMPLIFY_METERS): GeoJsonGeometry {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((ring) => {
        const closed = ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]
        const open = closed ? ring.slice(0, -1) : ring
        const simplified = simplifyLine(open, epsilon)
        if (simplified.length < 3) return ring
        const first = simplified[0]!
        return [...simplified, first]
      }),
    }
  }
  if (geometry.type === 'LineString') {
    return { type: 'LineString', coordinates: simplifyLine(geometry.coordinates, epsilon) }
  }
  return geometry
}

function shoelace(ring: [number, number][]): number {
  let area = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!
    const b = ring[i + 1]!
    area += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(area) / 2
}

function ringBbox(ring: [number, number][]): { minX: number, minY: number, maxX: number, maxY: number } {
  const xs = ring.map(p => p[0])
  const ys = ring.map(p => p[1])
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  }
}

/**
 * If a building footprint already fills most of its axis-aligned box, replace
 * it with that box so roofs look square instead of GIS-jagged.
 */
export function squareNearlyRectangularPolygon(geometry: GeoJsonGeometry, fillRatio = 0.82): GeoJsonGeometry {
  if (geometry.type !== 'Polygon') return geometry
  const ring = geometry.coordinates[0]
  if (!ring || ring.length < 4) return geometry
  const box = ringBbox(ring)
  const boxArea = Math.max(0.01, (box.maxX - box.minX) * (box.maxY - box.minY))
  if (shoelace(ring) / boxArea < fillRatio) return geometry
  const squared: [number, number][] = [
    [box.minX, box.minY],
    [box.maxX, box.minY],
    [box.maxX, box.maxY],
    [box.minX, box.maxY],
    [box.minX, box.minY],
  ]
  return { type: 'Polygon', coordinates: [squared] }
}

export function keepManualFeatures<T extends { manuallyModified: boolean }>(existing: T[]): T[] {
  return existing.filter(item => item.manuallyModified)
}

export function chassisFootprintMeters(): { length: number, width: number } {
  return { length: 12.2, width: 2.5 }
}

export function clipGeometryToPlane(geometry: GeoJsonGeometry, origin: YardLayoutOrigin): GeoJsonGeometry {
  const clamp = (a: number, b: number): [number, number] => [
    Math.min(origin.planeWidth, Math.max(0, a)),
    Math.min(origin.planeHeight, Math.max(0, b)),
  ]
  return mapGeometry(geometry, clamp)
}

function isTempObjectSize(box: { minX: number, minY: number, maxX: number, maxY: number }): boolean {
  const short = Math.min(box.maxX - box.minX, box.maxY - box.minY)
  const long = Math.max(box.maxX - box.minX, box.maxY - box.minY)
  return short >= 2 && short <= 4.5 && long >= 5 && long <= 16
}

/**
 * Cartographic cleanup after OSM/ortho generation: clip to the plane, drop
 * container-sized ortho blobs from pavement, omit pavement that sits under
 * buildings or public roads, and keep vegetation only at the perimeter.
 */
export function cleanGeneratedFeatures(
  features: YardFeatureDraft[],
  origin: YardLayoutOrigin,
): YardFeatureDraft[] {
  const blockers = features.filter(item => item.type === 'BUILDING' || item.type === 'ROAD')
  const clipped = features.map(feature => ({
    ...feature,
    localGeometry: clipGeometryToPlane(feature.localGeometry, origin),
  }))
  return clipped.filter((feature) => {
    const box = geometryBbox(feature.localGeometry)
    if (!box) return false
    if (feature.type === 'PAVEMENT' && isTempObjectSize(box)) return false
    if (feature.type === 'PAVEMENT') {
      const cx = (box.minX + box.maxX) / 2
      const cy = (box.minY + box.maxY) / 2
      if (blockers.some(item => featureContains(item, cx, cy))) return false
    }
    if (feature.type === 'VEGETATION') {
      const cx = (box.minX + box.maxX) / 2
      const cy = (box.minY + box.maxY) / 2
      const margin = 14
      return cx < margin || cy < margin
        || cx > origin.planeWidth - margin
        || cy > origin.planeHeight - margin
    }
    return true
  })
}

function polygonContainsPoint(ring: [number, number][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]
    const yi = ring[i]![1]
    const xj = ring[j]![0]
    const yj = ring[j]![1]
    const intersect = ((yi > y) !== (yj > y))
      && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

function featureContains(feature: YardFeatureDraft, x: number, y: number): boolean {
  const geom = feature.localGeometry
  if (geom.type === 'Polygon') return polygonContainsPoint(geom.coordinates[0] ?? [], x, y)
  if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some(poly => polygonContainsPoint(poly[0] ?? [], x, y))
  }
  return false
}

function slotCode(index: number): string {
  const row = Math.floor(index / 8)
  const col = (index % 8) + 1
  return `${String.fromCharCode(65 + (row % 26))}${String(col).padStart(2, '0')}`
}

function geometryBbox(geometry: GeoJsonGeometry): { minX: number, minY: number, maxX: number, maxY: number } | null {
  const points: [number, number][] = []
  if (geometry.type === 'Polygon') points.push(...(geometry.coordinates[0] ?? []))
  else if (geometry.type === 'MultiPolygon') {
    for (const poly of geometry.coordinates) points.push(...(poly[0] ?? []))
  }
  else if (geometry.type === 'LineString') points.push(...geometry.coordinates)
  else {
    for (const line of geometry.coordinates) points.push(...line)
  }
  if (!points.length) return null
  return ringBbox(points)
}

/**
 * Suggested container stalls on pavement, aligned to `rotationDeg`. Skips
 * building footprints and road centre-lines. Suggestions only — free placement
 * still works when these are empty.
 */
export function suggestSlots(input: {
  pavement: YardFeatureDraft[]
  buildings: YardFeatureDraft[]
  roads: YardFeatureDraft[]
  rotationDeg: number
  planeWidth: number
  planeHeight: number
  length?: number
  width?: number
  gap?: number
}): YardSlotDraft[] {
  const length = input.length ?? 12.2
  const width = input.width ?? 2.44
  const gap = input.gap ?? 1.4
  const pitchX = width + gap
  const pitchY = length + gap
  const rad = (input.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const cover = input.pavement
    .map(item => geometryBbox(item.localGeometry))
    .filter((box): box is NonNullable<typeof box> => Boolean(box))
  const minX = cover.length ? Math.min(...cover.map(box => box.minX)) : 8
  const minY = cover.length ? Math.min(...cover.map(box => box.minY)) : 8
  const slots: YardSlotDraft[] = []

  for (let row = 0; row < 24 && slots.length < 48; row++) {
    for (let col = 0; col < 16 && slots.length < 48; col++) {
      const localX = minX + 4 + col * pitchX
      const localY = minY + 4 + row * pitchY
      const x = (localX - minX) * cos - (localY - minY) * sin + minX
      const y = (localX - minX) * sin + (localY - minY) * cos + minY
      if (x < 2 || y < 2 || x > input.planeWidth - 2 || y > input.planeHeight - 2) continue
      const onPavement = input.pavement.length === 0 || input.pavement.some(item => featureContains(item, x, y))
      if (!onPavement) continue
      if (input.buildings.some(item => featureContains(item, x, y))) continue
      if (input.roads.some(item => featureContains(item, x, y))) continue
      slots.push({
        code: slotCode(slots.length),
        type: 'CONTAINER',
        x,
        y,
        width,
        height: length,
        rotation: input.rotationDeg,
      })
    }
  }
  return slots
}

export function fenceToPavement(boundary: GeoJsonPolygon, origin: YardLayoutOrigin): YardFeatureDraft {
  const local = geometryToLocal(boundary, origin)
  return {
    type: 'PAVEMENT',
    localGeometry: simplifyGeometry(local),
    geoGeometry: boundary,
    source: 'OSM',
    confidence: 0.4,
  }
}

export function layoutFromBoundary(
  boundary: GeoJsonPolygon,
  rotationDeg = 0,
  bufferMeters = YARD_BUFFER_METERS,
): { origin: YardLayoutOrigin, box: BoundingBox } | null {
  const fence = bboxFromPolygon(boundary)
  if (!fence) return null
  const box = bufferBbox(fence, bufferMeters)
  return { origin: layoutOriginFromBox(box, rotationDeg), box }
}

export function nearestSlot(
  x: number,
  y: number,
  slots: Array<{ x: number, y: number, rotation: number, id?: string }>,
  maxMeters = 2.4,
): { x: number, y: number, rotation: number, id?: string } | null {
  let best: { slot: typeof slots[number], dist: number } | null = null
  for (const slot of slots) {
    const dist = Math.hypot(slot.x - x, slot.y - y)
    if (dist > maxMeters) continue
    if (!best || dist < best.dist) best = { slot, dist }
  }
  return best?.slot ?? null
}

export function closedRing(points: [number, number][]): [number, number][] {
  if (!points.length) return points
  const first = points[0]!
  const last = points[points.length - 1]!
  if (first[0] === last[0] && first[1] === last[1]) return points
  return [...points, first]
}

export function lineToPolygon(line: [number, number][], widthMeters: number): GeoJsonPolygon {
  if (line.length < 2) {
    return { type: 'Polygon', coordinates: [closedRing(line)] }
  }
  const half = widthMeters / 2
  const left: [number, number][] = []
  const right: [number, number][] = []
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]!
    const b = line[i + 1]!
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    const nx = (-dy / len) * half
    const ny = (dx / len) * half
    left.push([a[0] + nx, a[1] + ny])
    right.push([a[0] - nx, a[1] - ny])
    if (i === line.length - 2) {
      left.push([b[0] + nx, b[1] + ny])
      right.push([b[0] - nx, b[1] - ny])
    }
  }
  return { type: 'Polygon', coordinates: [closedRing([...left, ...right.reverse()])] }
}
