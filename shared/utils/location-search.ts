/** Fields the pickup / drop-off pickers search against. */
export type LocationSearchFields = {
  name: string
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  locationCode?: string | null
  /** Container or chassis numbers that already matched this site. */
  matchedNumbers?: readonly string[] | null
}

/** Painted container / chassis digits used for inventory search. */
export function equipmentSearchNeedle(query: string): string {
  return query.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function equipmentNumberMatchesQuery(number: string | null | undefined, query: string): boolean {
  const needle = equipmentSearchNeedle(query)
  if (!needle) return false
  return (number ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(needle)
}

/** Empty or whitespace-only query matches every location. */
export function locationMatchesQuery(location: LocationSearchFields, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    location.name,
    location.addressLine1,
    location.city,
    location.state,
    location.locationCode,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ')
    .toLowerCase()
  if (haystack.includes(needle)) return true
  return (location.matchedNumbers ?? []).some(number => equipmentNumberMatchesQuery(number, query))
}

export function filterLocations<T extends LocationSearchFields>(items: readonly T[], query: string): T[] {
  if (!query.trim()) return [...items]
  return items.filter(item => locationMatchesQuery(item, query))
}
