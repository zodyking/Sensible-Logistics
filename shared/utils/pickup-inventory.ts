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
