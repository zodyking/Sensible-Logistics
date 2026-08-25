import { classifyHighway, type OsmWay } from '#shared/utils/osm-ways'
import type { BoundingBox } from '#shared/utils/geo'
import { bboxSizeMeters, isValidBbox } from '#shared/utils/geo'

/**
 * Streets, sidewalks and street-level photos for the location fence.
 *
 * Overpass (OSM) and Panoramax are public, no API key. Coverage of street
 * photos is uneven; the 2D yard still draws mapped highways when photos are
 * missing.
 */

export interface StreetLevelPhoto {
  thumbUrl: string
  imageUrl: string
  source: 'panoramax'
  attribution: string
  capturedAt: string | null
}

export interface MapContext {
  ways: OsmWay[]
  photo: StreetLevelPhoto | null
}

const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

function userAgent(): string {
  const app = String(useRuntimeConfig().appUrl || 'https://localhost').replace(/\/+$/, '')
  return `SensibleLogistics/1.0 (${app}; OSM location fence)`
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': userAgent(),
      'Accept': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(14_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function overpassQuery(box: BoundingBox): string {
  const bbox = `${box.south},${box.west},${box.north},${box.east}`
  return `[out:json][timeout:12];
(
  way["footway"="sidewalk"](${bbox});
  way["highway"="footway"](${bbox});
  way["highway"="path"](${bbox});
  way["highway"="pedestrian"](${bbox});
  way["highway"="steps"](${bbox});
  way["highway"="cycleway"](${bbox});
);
out geom 50;
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|service|living_street|track)$"](${bbox});
);
out geom 50;`
}

interface OverpassElement {
  type?: string
  id?: number
  tags?: Record<string, string>
  geometry?: Array<{ lat?: number, lon?: number }>
}

function parseWays(payload: { elements?: OverpassElement[] }): OsmWay[] {
  const ways: OsmWay[] = []
  for (const element of payload.elements ?? []) {
    if (element.type !== 'way' || !element.geometry?.length) continue
    const tags = element.tags ?? {}
    const points = element.geometry
      .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map(p => ({ lon: p.lon!, lat: p.lat! }))
    if (points.length < 2) continue
    ways.push({
      id: element.id ?? ways.length,
      kind: classifyHighway(tags),
      name: tags.name ?? null,
      highway: tags.highway ?? null,
      sidewalk: tags.sidewalk ?? tags.footway ?? null,
      points,
    })
  }
  return ways
}

async function fetchWays(box: BoundingBox): Promise<OsmWay[]> {
  const body = new URLSearchParams({ data: overpassQuery(box) })
  let lastError: unknown
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const payload = await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body,
      }) as { elements?: OverpassElement[] }
      return parseWays(payload)
    }
    catch (error) {
      lastError = error
      console.warn('[osm] Overpass failed', endpoint, error instanceof Error ? error.message : error)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Overpass is unreachable.')
}

function assetUrl(assets: Record<string, unknown> | undefined, key: 'thumb' | 'sd' | 'hd'): string | null {
  const value = assets?.[key]
  if (typeof value === 'string' && value.startsWith('http')) return value
  if (value && typeof value === 'object' && 'href' in value) {
    const href = (value as { href?: unknown }).href
    if (typeof href === 'string' && href.startsWith('http')) return href
  }
  return null
}

async function fetchStreetPhoto(box: BoundingBox): Promise<StreetLevelPhoto | null> {
  const url = `https://api.panoramax.xyz/api/search?bbox=${box.west},${box.south},${box.east},${box.north}&limit=1`
  try {
    const payload = await fetchJson(url) as { features?: Array<{ assets?: Record<string, unknown>, properties?: Record<string, unknown> }> }
    const feature = payload.features?.[0]
    if (!feature) return null
    const thumbUrl = assetUrl(feature.assets, 'thumb') ?? assetUrl(feature.assets, 'sd')
    const imageUrl = assetUrl(feature.assets, 'sd') ?? assetUrl(feature.assets, 'hd') ?? thumbUrl
    if (!thumbUrl || !imageUrl) return null
    const captured = feature.properties?.datetime ?? feature.properties?.created
    return {
      thumbUrl,
      imageUrl,
      source: 'panoramax',
      attribution: 'Street-level photo · Panoramax / OSM',
      capturedAt: typeof captured === 'string' ? captured : null,
    }
  }
  catch (error) {
    console.warn('[osm] Panoramax search failed', error instanceof Error ? error.message : error)
    return null
  }
}

export async function loadMapContext(box: BoundingBox): Promise<MapContext> {
  if (!isValidBbox(box)) {
    return { ways: [], photo: null }
  }

  const size = bboxSizeMeters(box)
  if (size.width * size.height > 4_000_000) {
    return { ways: [], photo: null }
  }

  const [ways, photo] = await Promise.all([
    fetchWays(box).catch(() => [] as OsmWay[]),
    fetchStreetPhoto(box),
  ])

  return { ways, photo }
}
