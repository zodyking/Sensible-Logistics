export const INVENTORY_VIEWS = ['locations', 'containers'] as const
export type InventoryView = (typeof INVENTORY_VIEWS)[number]

/** Map a route query value to the Inventory page view. Unknown values open locations. */
export function inventoryViewFromQuery(value: unknown): InventoryView {
  return value === 'containers' ? 'containers' : 'locations'
}
