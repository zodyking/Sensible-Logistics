/**
 * US mailing-line helpers. Photon/OSM calls NYC “New York”; drivers write the
 * borough (Brooklyn, Queens, Manhattan, Bronx, Staten Island).
 */

export interface PhotonAddressParts {
  name?: string | null
  housenumber?: string | null
  street?: string | null
  city?: string | null
  district?: string | null
  locality?: string | null
  county?: string | null
  state?: string | null
  postcode?: string | null
}

function fold(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
}

function isNewYorkState(state: string | null | undefined): boolean {
  const n = fold(state)
  return n === 'new york' || n === 'ny' || n === 'n y'
}

function isNewJerseyState(state: string | null | undefined): boolean {
  const n = fold(state)
  return n === 'new jersey' || n === 'nj' || n === 'n j'
}

/** Two-letter USPS code when we can resolve it. */
export function usStateCode(state: string | null | undefined): string | null {
  if (isNewYorkState(state)) return 'NY'
  if (isNewJerseyState(state)) return 'NJ'
  const n = fold(state)
  if (/^[a-z]{2}$/.test(n)) return n.toUpperCase()
  return null
}

/** NY / NJ from a 5-digit ZIP when the state field is blank. */
export function stateFromPostalCode(postalCode: string | null | undefined): 'NY' | 'NJ' | null {
  const digits = String(postalCode ?? '').replace(/\D/g, '')
  if (digits.length < 3) return null
  const prefix = digits.slice(0, 3)
  const n = Number(prefix)
  if (prefix === '005' || prefix === '063' || (n >= 100 && n <= 149)) return 'NY'
  if (n >= 70 && n <= 89) return 'NJ'
  return null
}

/** State on a location: stored state, then ZIP. */
export function locationStateCode(input: {
  state?: string | null
  postalCode?: string | null
}): string | null {
  return usStateCode(input.state) || stateFromPostalCode(input.postalCode)
}

/** True when origin and destination sit on opposite sides of the Hudson. */
export function isNyNjBridgeCross(
  originState: string | null | undefined,
  destState: string | null | undefined,
): boolean {
  const origin = usStateCode(originState) || originState || null
  const dest = usStateCode(destState) || destState || null
  return (origin === 'NY' && dest === 'NJ') || (origin === 'NJ' && dest === 'NY')
}

function isNewYorkCityLabel(city: string | null | undefined): boolean {
  const n = fold(city)
  return n === 'new york' || n === 'new york city' || n === 'nyc' || n === 'city of new york'
}

/** Canonical borough name, or null when the value is not a borough/county. */
export function nycBorough(value: string | null | undefined): string | null {
  const n = fold(value)
  if (!n) return null
  if (n === 'manhattan' || n === 'new york county') return 'Manhattan'
  if (n === 'brooklyn' || n === 'kings' || n === 'kings county') return 'Brooklyn'
  if (n === 'queens' || n === 'queens county') return 'Queens'
  if (n === 'bronx' || n === 'the bronx' || n === 'bronx county') return 'Bronx'
  if (n === 'staten island' || n === 'richmond' || n === 'richmond county') return 'Staten Island'
  return null
}

/**
 * City/locality for a US address. Inside New York City this is the borough,
 * never the generic “New York” city name.
 */
export function localityFromPhoton(parts: PhotonAddressParts): string | null {
  const city = parts.city?.trim() || null
  const inNewYorkCity = isNewYorkState(parts.state) && Boolean(
    isNewYorkCityLabel(city)
    || nycBorough(city)
    || nycBorough(parts.district)
    || nycBorough(parts.locality)
    || nycBorough(parts.county),
  )
  if (inNewYorkCity) {
    return nycBorough(parts.district)
      || nycBorough(parts.locality)
      || nycBorough(parts.county)
      || nycBorough(city)
      || city
  }
  return city || parts.district?.trim() || parts.county?.trim() || null
}

export function postalState(state: string | null | undefined): string | null {
  const raw = String(state ?? '').trim()
  if (!raw) return null
  const code = usStateCode(raw)
  if (code) return code
  return raw
}

/** “Brooklyn, NY 11236” — comma before state, space before ZIP. */
export function formatCityStateZip(
  city: string | null | undefined,
  state: string | null | undefined,
  postalCode: string | null | undefined,
): string {
  const place = city?.trim() || ''
  const st = postalState(state)
  const zip = String(postalCode ?? '').trim()
  if (place && st && zip) return `${place}, ${st} ${zip}`
  if (place && st) {
    if (fold(place) === fold(st) || fold(place) === fold(state)) return st
    return `${place}, ${st}`
  }
  if (place && zip) return `${place} ${zip}`
  return [place, st, zip].filter(Boolean).join(', ')
}

export function leadingHouseNumber(query: string): string | null {
  const match = query.trim().match(/^(\d+[A-Za-z]?)\b/)
  return match?.[1] ?? null
}

function streetStem(name: string): string {
  return fold(name)
    .replace(/\b(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|place|pl|lane|ln|way|court|ct|terrace|ter|circle|cir|parkway|pkwy)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function queryNamesStreet(query: string, road: string): boolean {
  const stem = streetStem(road)
  if (!stem) return false
  return fold(query).includes(stem)
}

export function streetLineFromPhoton(parts: PhotonAddressParts, query = ''): string | null {
  const streetName = parts.street?.trim() || null
  const name = parts.name?.trim() || null
  const road = streetName || name
  let number = parts.housenumber?.trim() || null
  if (!number && query && road && queryNamesStreet(query, road)) {
    number = leadingHouseNumber(query)
  }
  const line = [number, road].filter(Boolean).join(' ')
  return line || name || null
}

export function formatUsMailingLine(parts: {
  street?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
}): string {
  const street = parts.street?.trim() || ''
  const place = formatCityStateZip(parts.city, parts.state, parts.postalCode)
  return [street, place].filter(Boolean).join(', ')
}

export function displayNameFromPhoton(parts: PhotonAddressParts, query = ''): string {
  const street = streetLineFromPhoton(parts, query)
  const city = localityFromPhoton(parts)
  const mailing = formatUsMailingLine({
    street,
    city,
    state: parts.state,
    postalCode: parts.postcode,
  })
  const name = parts.name?.trim() || ''
  if (name && street && !fold(street).includes(fold(name))) {
    return mailing ? `${name}, ${mailing}` : name
  }
  return mailing || name
}
