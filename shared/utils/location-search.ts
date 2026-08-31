/** Fields the pickup / drop-off pickers search against. */
export type LocationSearchFields = {
  name: string
  addressLine1?: string | null
  city?: string | null
  state?: string | null
  locationCode?: string | null
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
  return haystack.includes(needle)
}

export function filterLocations<T extends LocationSearchFields>(items: readonly T[], query: string): T[] {
  if (!query.trim()) return [...items]
  return items.filter(item => locationMatchesQuery(item, query))
}
