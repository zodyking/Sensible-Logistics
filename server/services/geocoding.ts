import { and, eq, isNotNull, sql } from 'drizzle-orm'
import type { DbExecutor } from '../utils/db'
import { locations } from '../database/schema'

/**
 * Address resolution and duplicate detection (spec 7.1, 31.2).
 *
 * Geocoding must run against a self-hosted Nominatim instance — the public
 * nominatim.openstreetmap.org API forbids production autocomplete. Until that
 * service is deployed, {@link useGeocoder} reports unavailable and the location
 * form falls back to manual latitude/longitude entry.
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
}

export interface Geocoder {
  search(query: string, limit?: number): Promise<{ available: boolean, results: GeocodeResult[], message?: string }>
  reverse(latitude: number, longitude: number): Promise<{ available: boolean, result: GeocodeResult | null, message?: string }>
  healthCheck(): Promise<{ healthy: boolean, message: string }>
}

/**
 * TODO(Phase 2): implement `NominatimGeocoder` against
 * `NUXT_PUBLIC_GEOCODER_URL`, caching normalised results for saved locations.
 */
export class NotConfiguredGeocoder implements Geocoder {
  private readonly message
    = 'Self-hosted Nominatim is not deployed yet. Enter coordinates manually, or leave them blank and set them later.'

  async search(query: string) {
    void query
    return { available: false, results: [] as GeocodeResult[], message: this.message }
  }

  async reverse(latitude: number, longitude: number) {
    void latitude
    void longitude
    return { available: false, result: null, message: this.message }
  }

  async healthCheck() {
    return { healthy: false, message: this.message }
  }
}

let instance: Geocoder | undefined

export function useGeocoder(): Geocoder {
  if (!instance) instance = new NotConfiguredGeocoder()
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

/**
 * Surface likely existing locations before a user creates a duplicate yard or
 * customer record (spec 7.1, 24).
 *
 * Matches on the normalised address, then on name, then — when the new record
 * has coordinates — on PostGIS proximity within `radiusMeters`.
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
    const point = sql`ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)::geography`
    const nearby = await db
      .select({
        id: locations.id,
        name: locations.name,
        distance: sql<number>`ST_Distance(${locations.centroid}::geography, ${point})`,
      })
      .from(locations)
      .where(and(
        eq(locations.companyId, companyId),
        isNotNull(locations.centroid),
        sql`ST_DWithin(${locations.centroid}::geography, ${point}, ${radiusMeters})`,
      ))
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
