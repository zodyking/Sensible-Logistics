import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { bboxFromExtent, type BoundingBox } from '#shared/utils/geo'
import type { DbExecutor } from '../utils/db'
import { locations } from '../database/schema'

/**
 * Address resolution and duplicate detection (spec 7.1, 31.2).
 *
 * Autocomplete uses Photon (Komoot) — OpenStreetMap data, no API key. A self-hosted
 * Nominatim URL in `NUXT_PUBLIC_GEOCODER_URL` is preferred when set.
 */

export interface GeocodeResult {
  displayName: string
  latitude: number
  longitude: number
  confidence: number
  addressLine1: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  country: string | null
  bbox: BoundingBox | null
}

export interface Geocoder {
  search(query: string, limit?: number): Promise<{ available: boolean, results: GeocodeResult[], message?: string }>
  reverse(latitude: number, longitude: number): Promise<{ available: boolean, result: GeocodeResult | null, message?: string }>
  healthCheck(): Promise<{ healthy: boolean, message: string }>
}

function userAgent(): string {
  const app = String(useRuntimeConfig().appUrl || 'https://localhost').replace(/\/+$/, '')
  return `SensibleLogistics/1.0 (${app}; location autocomplete)`
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { 'User-Agent': userAgent(), 'Accept': 'application/json' },
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) {
    throw new Error(`Geocoder responded ${response.status}`)
  }
  return response.json()
}

interface PhotonFeature {
  geometry?: { coordinates?: number[] }
  properties?: {
    name?: string
    housenumber?: string
    street?: string
    city?: string
    district?: string
    county?: string
    state?: string
    postcode?: string
    country?: string
    countrycode?: string
    extent?: number[]
    type?: string
  }
}

function photonToResult(feature: PhotonFeature): GeocodeResult | null {
  const coords = feature.geometry?.coordinates
  const lon = coords?.[0]
  const lat = coords?.[1]
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const p = feature.properties ?? {}
  const street = [p.housenumber, p.street].filter(Boolean).join(' ')
  const city = p.city || p.district || p.county || null
  const display = [p.name, street, city, p.state].filter(Boolean).join(', ')
  return {
    displayName: display || `${lat}, ${lon}`,
    latitude: lat!,
    longitude: lon!,
    confidence: 0.85,
    addressLine1: street || p.name || null,
    city,
    state: p.state ?? null,
    postalCode: p.postcode ?? null,
    country: p.countrycode?.toUpperCase() ?? p.country ?? null,
    bbox: Array.isArray(p.extent) ? bboxFromExtent(p.extent) : null,
  }
}

class PhotonGeocoder implements Geocoder {
  constructor(private readonly endpoint: string) {}

  private searchUrl(query: string, limit: number) {
    const base = this.endpoint.replace(/\/+$/, '')
    return `${base}/api/?q=${encodeURIComponent(query)}&limit=${limit}&lang=en`
  }

  async search(query: string, limit = 6) {
    const q = query.trim()
    if (q.length < 3) return { available: true, results: [] as GeocodeResult[] }
    try {
      const payload = await fetchJson(this.searchUrl(q, limit)) as { features?: PhotonFeature[] }
      const results = (payload.features ?? []).map(photonToResult).filter((r): r is GeocodeResult => r !== null)
      return { available: true, results }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Geocoder unreachable.'
      console.warn('[geocode] Photon search failed:', message)
      return { available: false, results: [] as GeocodeResult[], message }
    }
  }

  async reverse(latitude: number, longitude: number) {
    try {
      const base = this.endpoint.replace(/\/+$/, '')
      const payload = await fetchJson(
        `${base}/reverse?lon=${longitude}&lat=${latitude}&limit=1&lang=en`,
      ) as { features?: PhotonFeature[] }
      const result = payload.features?.[0] ? photonToResult(payload.features[0]) : null
      return { available: true, result }
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Geocoder unreachable.'
      return { available: false, result: null, message }
    }
  }

  async healthCheck() {
    const probe = await this.search('port', 1)
    return probe.available
      ? { healthy: true, message: 'Photon / OpenStreetMap autocomplete is ready.' }
      : { healthy: false, message: probe.message ?? 'Photon is unreachable.' }
  }
}

let instance: Geocoder | undefined

export function useGeocoder(): Geocoder {
  if (!instance) {
    const custom = String(useRuntimeConfig().public.geocoderUrl ?? '').trim()
    instance = new PhotonGeocoder(custom || 'https://photon.komoot.io')
  }
  return instance
}

/** Lower-cased, punctuation-stripped address key used for duplicate matching. */
export function normalizeAddress(parts: {
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
}): string {
  return [parts.addressLine1, parts.city, parts.state, parts.postalCode]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface DuplicateSuggestion {
  id: string
  name: string
  reason: 'SAME_ADDRESS' | 'SIMILAR_NAME' | 'NEARBY'
  distanceMeters: number | null
}

/** Mean Earth radius in metres (WGS 84 authalic radius). */
const EARTH_RADIUS_METERS = 6371008.8

/**
 * Great-circle distance in metres between a stored location and a point.
 *
 * The haversine formula keeps proximity search on plain PostgreSQL — no PostGIS
 * or earthdistance extension — which matters because the database is operator
 * supplied. Accuracy is well inside the tolerance of duplicate detection at
 * yard scale. Latitude/longitude are `numeric`, and the trigonometric functions
 * only accept double precision, hence the casts.
 */
function haversineMeters(latitude: number, longitude: number) {
  const lat = sql`${latitude}::double precision`
  const lon = sql`${longitude}::double precision`
  const rowLat = sql`${locations.latitude}::double precision`
  const rowLon = sql`${locations.longitude}::double precision`

  return sql<number>`
    ${EARTH_RADIUS_METERS}::double precision * 2 * asin(sqrt(
      power(sin(radians(${lat} - ${rowLat}) / 2), 2)
      + cos(radians(${rowLat})) * cos(radians(${lat}))
      * power(sin(radians(${lon} - ${rowLon}) / 2), 2)
    ))`
}

/**
 * Surface likely existing locations before a user creates a duplicate yard or
 * customer record (spec 7.1, 24).
 *
 * Matches on the normalised address, then on name, then — when the new record
 * has coordinates — on distance within `radiusMeters`.
 */
export async function findDuplicateCandidates(
  db: DbExecutor,
  companyId: string,
  input: { name: string, normalizedAddress: string, latitude?: number | null, longitude?: number | null },
  radiusMeters = 400,
): Promise<DuplicateSuggestion[]> {
  const suggestions = new Map<string, DuplicateSuggestion>()

  if (input.normalizedAddress) {
    const rows = await db
      .select({ id: locations.id, name: locations.name })
      .from(locations)
      .where(and(eq(locations.companyId, companyId), eq(locations.normalizedAddress, input.normalizedAddress)))
      .limit(5)

    for (const row of rows) {
      suggestions.set(row.id, { id: row.id, name: row.name, reason: 'SAME_ADDRESS', distanceMeters: null })
    }
  }

  const nameRows = await db
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(and(eq(locations.companyId, companyId), sql`lower(${locations.name}) = lower(${input.name})`))
    .limit(5)

  for (const row of nameRows) {
    if (!suggestions.has(row.id)) {
      suggestions.set(row.id, { id: row.id, name: row.name, reason: 'SIMILAR_NAME', distanceMeters: null })
    }
  }

  if (input.latitude != null && input.longitude != null) {
    const distance = haversineMeters(input.latitude, input.longitude)
    const nearby = await db
      .select({
        id: locations.id,
        name: locations.name,
        distance,
      })
      .from(locations)
      .where(and(
        eq(locations.companyId, companyId),
        isNotNull(locations.latitude),
        isNotNull(locations.longitude),
        sql`${distance} <= ${radiusMeters}`,
      ))
      .orderBy(distance)
      .limit(5)

    for (const row of nearby) {
      if (!suggestions.has(row.id)) {
        suggestions.set(row.id, {
          id: row.id,
          name: row.name,
          reason: 'NEARBY',
          distanceMeters: Math.round(Number(row.distance)),
        })
      }
    }
  }

  return [...suggestions.values()]
}

interface OverpassElement {
  type: string
  geometry?: Array<{ lat: number, lon: number }>
}

/**
 * Heading of the nearest OSM highway to a point, in degrees from north.
 * Used to auto-align a dropped container with the street.
 */
export async function nearestStreetHeading(
  latitude: number,
  longitude: number,
  radiusMeters = 80,
): Promise<{ heading: number, source: 'OSM' | 'NONE', message?: string } | null> {
  const query = `[out:json][timeout:8];way(around:${Math.round(radiusMeters)},${latitude},${longitude})["highway"~"^(residential|service|unclassified|tertiary|secondary|primary|living_street|industrial|trunk)$"];out geom;`
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'User-Agent': userAgent(),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(9_000),
    })
    if (!response.ok) {
      return { heading: 0, source: 'NONE', message: `Overpass responded ${response.status}` }
    }
    const payload = await response.json() as { elements?: OverpassElement[] }
    let best: { distance: number, heading: number } | null = null
    for (const element of payload.elements ?? []) {
      const geom = element.geometry ?? []
      for (let i = 0; i < geom.length - 1; i++) {
        const a = geom[i]!
        const b = geom[i + 1]!
        const midLat = (a.lat + b.lat) / 2
        const midLon = (a.lon + b.lon) / 2
        const distance = geodesicMeters(latitude, longitude, midLat, midLon)
        if (!best || distance < best.distance) {
          best = { distance, heading: geodesicBearing(a.lat, a.lon, b.lat, b.lon) }
        }
      }
    }
    if (!best) return { heading: 0, source: 'NONE', message: 'No nearby street.' }
    return { heading: best.heading, source: 'OSM' }
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Overpass unreachable.'
    return { heading: 0, source: 'NONE', message }
  }
}

function geodesicMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function geodesicBearing(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const φ1 = (fromLat * Math.PI) / 180
  const φ2 = (toLat * Math.PI) / 180
  const Δλ = ((toLng - fromLng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  const deg = (Math.atan2(y, x) * 180) / Math.PI
  return (deg + 360) % 360
}
