import { bboxFromPolygon, longestEdgeBearing, type GeoJsonPolygon } from '#shared/utils/geo'
import {
  bufferBbox,
  fenceToPavement,
  geometryToLocal,
  layoutOriginFromBox,
  lineToPolygon,
  simplifyGeometry,
  squareNearlyRectangularPolygon,
  suggestSlots,
  YARD_BUFFER_METERS,
  YARD_GENERATOR_VERSION,
  type YardFeatureDraft,
  type YardLayoutOrigin,
  type YardSlotDraft,
  cleanGeneratedFeatures,
} from '#shared/utils/yard-plan'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

interface OverpassElement {
  type?: string
  tags?: Record<string, string>
  geometry?: Array<{ lat: number, lon: number }>
}

function userAgent(): string {
  const app = String(useRuntimeConfig().appUrl || 'https://localhost').replace(/\/+$/, '')
  return `SensibleLogistics/1.0 (${app}; yard visualizer)`
}

function highwayWidth(highway: string): number {
  if (['motorway', 'trunk', 'primary'].includes(highway)) return 12
  if (['secondary', 'tertiary'].includes(highway)) return 9
  if (['residential', 'unclassified', 'living_street'].includes(highway)) return 7
  if (['service', 'industrial'].includes(highway)) return 5.5
  if (highway === 'driveway') return 4
  return 6
}

function closed(line: [number, number][]): boolean {
  if (line.length < 4) return false
  const a = line[0]!
  const b = line[line.length - 1]!
  return a[0] === b[0] && a[1] === b[1]
}

export interface YardGenerateResult {
  ok: boolean
  generatorVersion: string
  origin: YardLayoutOrigin
  features: YardFeatureDraft[]
  slots: YardSlotDraft[]
  warnings: string[]
  engine: 'python' | 'osm-fallback'
  error?: string
}

async function fetchOverpass(south: number, west: number, north: number, east: number): Promise<OverpassElement[]> {
  const query = `[out:json][timeout:25];(
    way["building"](${south},${west},${north},${east});
    way["highway"](${south},${west},${north},${east});
    way["railway"](${south},${west},${north},${east});
    way["barrier"~"^(fence|wall|gate)$"](${south},${west},${north},${east});
  );out geom;`
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'User-Agent': userAgent(),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(28_000),
  })
  if (!response.ok) return []
  const payload = await response.json() as { elements?: OverpassElement[] }
  return payload.elements ?? []
}

function wayToFeature(element: OverpassElement, origin: YardLayoutOrigin): YardFeatureDraft | null {
  const tags = element.tags ?? {}
  const geoLine = (element.geometry ?? [])
    .filter(pt => Number.isFinite(pt.lat) && Number.isFinite(pt.lon))
    .map(pt => [pt.lon, pt.lat] as [number, number])
  if (geoLine.length < 2) return null
  const localLineGeom = geometryToLocal({ type: 'LineString', coordinates: geoLine }, origin)
  const localLine = localLineGeom.type === 'LineString' ? localLineGeom.coordinates : []

  if (tags.building) {
    const localRing = closed(localLine) ? localLine : [...localLine, localLine[0]!]
    const geoRing = closed(geoLine) ? geoLine : [...geoLine, geoLine[0]!]
    const localGeom = squareNearlyRectangularPolygon(
      simplifyGeometry({ type: 'Polygon', coordinates: [localRing] }),
    )
    return {
      type: 'BUILDING',
      localGeometry: localGeom,
      geoGeometry: { type: 'Polygon', coordinates: [geoRing] },
      source: 'OSM',
      confidence: 0.9,
    }
  }

  const railway = tags.railway
  if (railway === 'rail' || railway === 'light_rail' || railway === 'tram') {
    const localGeom = simplifyGeometry(lineToPolygon(localLine, 3.2))
    return {
      type: 'RAIL',
      localGeometry: localGeom,
      geoGeometry: { type: 'LineString', coordinates: geoLine },
      source: 'OSM',
      confidence: 0.85,
    }
  }

  const barrier = tags.barrier
  if (barrier === 'fence' || barrier === 'wall') {
    return {
      type: 'FENCE',
      localGeometry: simplifyGeometry(lineToPolygon(localLine, 0.4)),
      geoGeometry: { type: 'LineString', coordinates: geoLine },
      source: 'OSM',
      confidence: 0.7,
    }
  }
  if (barrier === 'gate') {
    return {
      type: 'GATE',
      localGeometry: simplifyGeometry(lineToPolygon(localLine, 1.2)),
      geoGeometry: { type: 'LineString', coordinates: geoLine },
      source: 'OSM',
      confidence: 0.7,
    }
  }

  const highway = tags.highway
  if (!highway) return null
  const kind = highway === 'driveway' || highway === 'service' ? 'DRIVEWAY' : 'ROAD'
  return {
    type: kind,
    localGeometry: simplifyGeometry(lineToPolygon(localLine, highwayWidth(highway))),
    geoGeometry: { type: 'LineString', coordinates: geoLine },
    source: 'OSM',
    confidence: 0.8,
  }
}

/** OSM-only site plan used when the Python worker is missing or fails. */
export async function generateYardFromOsm(
  boundary: GeoJsonPolygon,
  rotationHint = 0,
): Promise<YardGenerateResult> {
  const fence = bboxFromPolygon(boundary)
  if (!fence) {
    return {
      ok: false,
      generatorVersion: YARD_GENERATOR_VERSION,
      origin: layoutOriginFromBox({ west: 0, south: 0, east: 0.001, north: 0.001 }),
      features: [],
      slots: [],
      warnings: [],
      engine: 'osm-fallback',
      error: 'Fence polygon is empty.',
    }
  }

  const box = bufferBbox(fence, YARD_BUFFER_METERS)
  const rotation = rotationHint || longestEdgeBearing(boundary) || 0
  const origin = layoutOriginFromBox(box, rotation)
  const warnings: string[] = []
  let elements: OverpassElement[] = []
  try {
    elements = await fetchOverpass(box.south, box.west, box.north, box.east)
  }
  catch {
    warnings.push('OpenStreetMap was unreachable; the fence is the pavement.')
  }

  const features = elements
    .map(element => wayToFeature(element, origin))
    .filter((item): item is YardFeatureDraft => Boolean(item))

  if (!features.some(item => item.type === 'PAVEMENT')) {
    features.unshift(fenceToPavement(boundary, origin))
    if (!elements.length) warnings.push('OpenStreetMap returned no nearby ways; using the fence as pavement.')
    else warnings.push('No paved area was detected; the drawn fence is the operating surface.')
  }

  const cleaned = cleanGeneratedFeatures(features, origin)
  const slots = suggestSlots({
    pavement: cleaned.filter(item => item.type === 'PAVEMENT'),
    buildings: cleaned.filter(item => item.type === 'BUILDING'),
    roads: cleaned.filter(item => item.type === 'ROAD' || item.type === 'DRIVEWAY'),
    rotationDeg: origin.rotationDeg,
    planeWidth: origin.planeWidth,
    planeHeight: origin.planeHeight,
  })

  return {
    ok: true,
    generatorVersion: YARD_GENERATOR_VERSION,
    origin,
    features: cleaned,
    slots,
    warnings,
    engine: 'osm-fallback',
  }
}
