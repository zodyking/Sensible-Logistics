import { nycBorough } from './us-address'

function fold(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
}

function isNewYorkState(state: string | null | undefined): boolean {
  const n = fold(state)
  return n === 'new york' || n === 'ny' || n === 'n y'
}

function isNewYorkCityLabel(city: string | null | undefined): boolean {
  const n = fold(city)
  return n === 'new york' || n === 'new york city' || n === 'nyc' || n === 'city of new york'
}

export interface LocationAddressFields {
  id: string
  normalizedAddress?: string | null
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
}

/** Street line only — used when two customer records share a building. */
export function streetKey(line: string | null | undefined): string {
  return fold(line)
}

export function cityToken(city: string | null | undefined, state?: string | null): string {
  if (nycBorough(city)) return 'nyc'
  if (isNewYorkState(state) && isNewYorkCityLabel(city)) return 'nyc'
  return fold(city)
}

export function locationAddressKey(parts: Omit<LocationAddressFields, 'id'>): string {
  const stored = String(parts.normalizedAddress ?? '').trim().toLowerCase()
  if (stored) return stored
  return [parts.addressLine1, parts.city, parts.state, parts.postalCode]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sameCityOrPostal(a: LocationAddressFields, b: LocationAddressFields): boolean {
  const postalA = fold(a.postalCode).replace(/\s+/g, '')
  const postalB = fold(b.postalCode).replace(/\s+/g, '')
  if (postalA && postalB && postalA.slice(0, 5) === postalB.slice(0, 5)) return true
  const cityA = cityToken(a.city, a.state)
  const cityB = cityToken(b.city, b.state)
  return Boolean(cityA && cityB && cityA === cityB)
}

export function locationsShareAddress(a: LocationAddressFields, b: LocationAddressFields): boolean {
  const keyA = locationAddressKey(a)
  const keyB = locationAddressKey(b)
  if (keyA && keyB && keyA === keyB) return true
  const streetA = streetKey(a.addressLine1)
  const streetB = streetKey(b.addressLine1)
  return Boolean(streetA && streetB && streetA === streetB && sameCityOrPostal(a, b))
}

/** Location ids at the same physical address as `site`, always including site. */
export function locationIdsSharingAddress(
  site: LocationAddressFields,
  catalog: LocationAddressFields[],
): string[] {
  const key = locationAddressKey(site)
  const street = streetKey(site.addressLine1)
  if (!key && !street) return [site.id]
  const ids = catalog.filter(row => row.id === site.id || locationsShareAddress(site, row)).map(row => row.id)
  return ids.includes(site.id) ? ids : [site.id, ...ids]
}
