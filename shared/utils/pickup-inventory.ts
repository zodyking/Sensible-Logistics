/**
 * On-site boxes for New Pickup / swap inventory.
 *
 * A customer swap lists every container already at that site. Boxes dropped
 * empty (status Loading) are still the load the driver is there to pick up,
 * even when `isLoaded` was never flipped.
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

export function visiblePickupSiteContainers<T>(
  items: T[],
  _options: { swap?: boolean } = {},
): T[] {
  return items
}
