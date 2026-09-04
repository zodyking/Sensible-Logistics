/**
 * On-site boxes for New Pickup / swap inventory. Nothing is filtered by load
 * state: a box dropped empty is still the one the driver is there to collect.
 */
export function mergeSiteContainers<T extends { id: string }>(
  fromLocation: T[],
  fromInventory: T[],
): T[] {
  const byId = new Map<string, T>()
  for (const item of fromLocation) byId.set(item.id, item)
  for (const item of fromInventory) {
    const existing = byId.get(item.id)
    byId.set(item.id, existing ? { ...existing, ...item } : item)
  }
  return [...byId.values()]
}

export function mergeCsxReleases<T extends { id: string, numberNormalized?: string | null, number?: string }>(
  onSite: T[],
  releases: T[],
): T[] {
  const seen = new Set(onSite.map(item => (item.numberNormalized || item.number || item.id).toUpperCase().replace(/[^A-Z0-9]/g, '')))
  const extra = releases.filter((item) => {
    const key = (item.numberNormalized || item.number || item.id).toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return [...onSite, ...extra]
}
