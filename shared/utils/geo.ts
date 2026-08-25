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
