/**
 * Centralised operational vocabulary. UI and server both read from here so
 * statuses are never hard-coded across screens (engineering rule, spec 27.3).
 */

export const ROLES = ['DRIVER', 'ADMIN'] as const
export type Role = (typeof ROLES)[number]

/** Public signup picks. Dispatcher memberships are stored as ADMIN. */
export const SIGNUP_ROLES = ['DRIVER', 'DISPATCHER'] as const
export type SignupRole = (typeof SIGNUP_ROLES)[number]

export const SIGNUP_ROLE_LABELS: Record<SignupRole, string> = {
  DRIVER: 'Driver',
  DISPATCHER: 'Dispatcher',
}

export function membershipRoleForSignup(role: SignupRole): Role {
  return role === 'DISPATCHER' ? 'ADMIN' : 'DRIVER'
}

export function roleHomePath(role: Role | null | undefined): string {
  return role === 'ADMIN' ? '/admin' : '/'
}

export function roleLabel(role: Role | null | undefined): string {
  return role === 'ADMIN' ? 'Dispatcher' : 'Driver'
}

export const ACTIVE_POOL_STATES = [
  'INACTIVE',
  'PICKUP_IN_PROGRESS',
  'DRIVER_CUSTODY',
  'AT_LOCATION',
  'EXCEPTION',
] as const
export type ActivePoolState = (typeof ACTIVE_POOL_STATES)[number]

export const ACTIVE_POOL_LABELS: Record<ActivePoolState, string> = {
  INACTIVE: 'Inactive',
  PICKUP_IN_PROGRESS: 'Pickup underway',
  DRIVER_CUSTODY: 'In transit',
  AT_LOCATION: 'On site',
  EXCEPTION: 'Needs attention',
}

/** Chip variants pair a colour with a glyph so status never depends on hue alone. */
export const ACTIVE_POOL_CHIP: Record<ActivePoolState, 'ok' | 'warn' | 'err' | 'transit' | 'idle'> = {
  INACTIVE: 'idle',
  PICKUP_IN_PROGRESS: 'warn',
  DRIVER_CUSTODY: 'transit',
  AT_LOCATION: 'ok',
  EXCEPTION: 'err',
}

/**
 * Operational container status for the current service life — where the box
 * sits in the marine/rail → yard/customer → marine/rail cycle.
 */
export const CONTAINER_STATUSES = [
  'AVAILABLE',
  'IN_TRANSIT',
  'AT_YARD',
  'LOADING',
  'RETURNED',
] as const
export type ContainerStatus = (typeof CONTAINER_STATUSES)[number]

export const CONTAINER_STATUS_LABELS: Record<ContainerStatus, string> = {
  AVAILABLE: 'Available',
  IN_TRANSIT: 'In transit',
  AT_YARD: 'On site',
  LOADING: 'Loading',
  RETURNED: 'Returned',
}

export const CONTAINER_STATUS_CHIP: Record<ContainerStatus, 'ok' | 'warn' | 'err' | 'transit' | 'idle'> = {
  AVAILABLE: 'idle',
  IN_TRANSIT: 'transit',
  AT_YARD: 'ok',
  LOADING: 'warn',
  RETURNED: 'idle',
}

export type StatusChipVariant = 'ok' | 'warn' | 'err' | 'transit' | 'idle'

/**
 * One operator-facing situation for a box. Container status and pool state
 * overlap (AT_YARD vs AT_LOCATION), so screens should show this instead of
 * two badges that say the same thing.
 */
export const CONTAINER_SITUATIONS = [
  'ON_SITE',
  'LOADING',
  'PICKUP_UNDERWAY',
  'IN_TRANSIT',
  'NEEDS_ATTENTION',
  'RETURNED',
  'INACTIVE',
  'AVAILABLE',
] as const
export type ContainerSituationKey = (typeof CONTAINER_SITUATIONS)[number]

export const CONTAINER_SITUATION_LABELS: Record<ContainerSituationKey, string> = {
  ON_SITE: 'On site',
  LOADING: 'Loading',
  PICKUP_UNDERWAY: 'Pickup underway',
  IN_TRANSIT: 'In transit',
  NEEDS_ATTENTION: 'Needs attention',
  RETURNED: 'Returned',
  INACTIVE: 'Inactive',
  AVAILABLE: 'Available',
}

export const CONTAINER_SITUATION_CHIP: Record<ContainerSituationKey, StatusChipVariant> = {
  ON_SITE: 'ok',
  LOADING: 'warn',
  PICKUP_UNDERWAY: 'warn',
  IN_TRANSIT: 'transit',
  NEEDS_ATTENTION: 'err',
  RETURNED: 'idle',
  INACTIVE: 'idle',
  AVAILABLE: 'idle',
}

/** Filter chips on the containers table — Available is folded into On site. */
export const CONTAINER_SITUATION_FILTERS = [
  'ON_SITE',
  'LOADING',
  'PICKUP_UNDERWAY',
  'IN_TRANSIT',
  'NEEDS_ATTENTION',
  'RETURNED',
  'INACTIVE',
] as const
export type ContainerSituationFilter = (typeof CONTAINER_SITUATION_FILTERS)[number]

export interface ContainerSituationInput {
  containerStatus: ContainerStatus
  activePoolState: ActivePoolState
  /** Customer sites always read as Loading while the box is on site. */
  locationType?: string | null
}

export interface ContainerSituation {
  key: ContainerSituationKey
  label: string
  variant: StatusChipVariant
}

export function containerSituation(input: ContainerSituationInput): ContainerSituation {
  const { activePoolState } = input
  const containerStatus = activePoolState === 'AT_LOCATION' && input.locationType === 'CUSTOMER'
    ? 'LOADING'
    : input.containerStatus

  let key: ContainerSituationKey = 'ON_SITE'
  if (activePoolState === 'EXCEPTION') key = 'NEEDS_ATTENTION'
  else if (activePoolState === 'PICKUP_IN_PROGRESS') key = 'PICKUP_UNDERWAY'
  else if (activePoolState === 'DRIVER_CUSTODY' || containerStatus === 'IN_TRANSIT') key = 'IN_TRANSIT'
  else if (containerStatus === 'LOADING') key = 'LOADING'
  else if (containerStatus === 'RETURNED') key = 'RETURNED'
  else if (activePoolState === 'INACTIVE') key = 'INACTIVE'
  else if (activePoolState === 'AT_LOCATION' || containerStatus === 'AT_YARD') key = 'ON_SITE'
  else if (containerStatus === 'AVAILABLE') key = 'AVAILABLE'

  return {
    key,
    label: CONTAINER_SITUATION_LABELS[key],
    variant: CONTAINER_SITUATION_CHIP[key],
  }
}

/** Business classification required on every container (spec 5.1). */
export const CONTAINER_TYPES = ['TROPICAL', 'ZIM', 'CMA', 'KING_OCEAN'] as const
export type ContainerType = (typeof CONTAINER_TYPES)[number]

export const CONTAINER_TYPE_LABELS: Record<ContainerType, string> = {
  TROPICAL: 'Tropical',
  ZIM: 'ZIM',
  CMA: 'CMA',
  KING_OCEAN: 'King Ocean',
}

/** Map paint for each steamship brand — fill/stroke on OSM rectangles. */
export const CONTAINER_TYPE_PAINT: Record<ContainerType, { fill: string, stroke: string, emptyFill: string }> = {
  KING_OCEAN: { fill: '#C45C26', stroke: '#8A3A14', emptyFill: '#F3DDD0' },
  TROPICAL: { fill: '#2F6E62', stroke: '#1C443C', emptyFill: '#D5E8E3' },
  CMA: { fill: '#1D3A57', stroke: '#0C1E30', emptyFill: '#D5DEE6' },
  ZIM: { fill: '#5B3A9E', stroke: '#3D2470', emptyFill: '#E4DCF3' },
}

export type ContainerTypeCounts = Record<ContainerType, number>

export function emptyTypeCounts(): ContainerTypeCounts {
  return { KING_OCEAN: 0, TROPICAL: 0, CMA: 0, ZIM: 0 }
}

export function countContainersByType(items: Array<{ containerType: ContainerType }>): ContainerTypeCounts {
  const counts = emptyTypeCounts()
  for (const item of items) counts[item.containerType] += 1
  return counts
}

/** Physical equipment size/type — distinct from the business classification. */
export const EQUIPMENT_TYPES = [
  'DRY_20',
  'DRY_40',
  'HC_40',
  'HC_45',
  'REEFER',
  'TANK',
  'OPEN_TOP',
  'FLAT_RACK',
  'OTHER',
] as const
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number]

/**
 * Lengths a driver can pick when classifying a new container.
 * Stored as DRY_20 / DRY_40; older records may still use HC_40, reefer, etc.
 */
export const PICKUP_EQUIPMENT_SIZES = ['DRY_20', 'DRY_40'] as const
export type PickupEquipmentSize = (typeof PICKUP_EQUIPMENT_SIZES)[number]

export const PICKUP_EQUIPMENT_SIZE_LABELS: Record<PickupEquipmentSize, string> = {
  DRY_20: '20ft',
  DRY_40: '40ft',
}

export const EQUIPMENT_TYPE_LABELS: Record<EquipmentType, string> = {
  DRY_20: `20' Dry`,
  DRY_40: `40' Dry`,
  HC_40: `40' High Cube`,
  HC_45: `45' High Cube`,
  REEFER: 'Reefer',
  TANK: 'Tank',
  OPEN_TOP: 'Open Top',
  FLAT_RACK: 'Flat Rack',
  OTHER: 'Other',
}

/** Compact length labels used on the active-trip card (`40' HC`). */
export const EQUIPMENT_TYPE_SHORT: Record<EquipmentType, string> = {
  DRY_20: `20' Dry`,
  DRY_40: `40' Dry`,
  HC_40: `40' HC`,
  HC_45: `45' HC`,
  REEFER: 'Reefer',
  TANK: 'Tank',
  OPEN_TOP: 'OT',
  FLAT_RACK: 'FR',
  OTHER: 'Other',
}

/** Nominal length in feet — drives proportional sizing on the map. */
export const EQUIPMENT_LENGTH_FT: Record<EquipmentType, number> = {
  DRY_20: 20,
  DRY_40: 40,
  HC_40: 40,
  HC_45: 45,
  REEFER: 40,
  TANK: 20,
  OPEN_TOP: 40,
  FLAT_RACK: 40,
  OTHER: 40,
}

const FT_TO_M = 0.3048
const CONTAINER_WIDTH_FT = 8

export function pickupEquipmentSizeLabel(type: EquipmentType): string {
  if (type === 'DRY_20' || type === 'DRY_40') return PICKUP_EQUIPMENT_SIZE_LABELS[type]
  return EQUIPMENT_LENGTH_FT[type] <= 20 ? '20ft' : '40ft'
}

/** ISO footprint in metres for drawing a box on OpenStreetMap. */
export function equipmentFootprintMeters(type: EquipmentType): { length: number, width: number } {
  return {
    length: EQUIPMENT_LENGTH_FT[type] * FT_TO_M,
    width: CONTAINER_WIDTH_FT * FT_TO_M,
  }
}

export const TRIP_KINDS = ['CONTAINER', 'BARE_CHASSIS'] as const
export type TripKind = (typeof TRIP_KINDS)[number]

export const TRIP_KIND_LABELS: Record<TripKind, string> = {
  CONTAINER: 'Container',
  BARE_CHASSIS: 'Bare chassis',
}

export const TRIP_STATUSES = [
  'DRAFT',
  'PICKUP_IN_PROGRESS',
  'IN_TRANSIT',
  'DROPOFF_IN_PROGRESS',
  'DROPPED_OFF',
  'COMPLETED',
  'CANCELLED',
  'EXCEPTION',
] as const
export type TripStatus = (typeof TRIP_STATUSES)[number]

/** Driver still owns the movement — cancel from Home, do not delete from history. */
export const LIVE_TRIP_STATUSES = ['PICKUP_IN_PROGRESS', 'IN_TRANSIT', 'DROPOFF_IN_PROGRESS'] as const
export type LiveTripStatus = (typeof LIVE_TRIP_STATUSES)[number]

export function isLiveTripStatus(status: string | null | undefined): boolean {
  return Boolean(status && (LIVE_TRIP_STATUSES as readonly string[]).includes(status))
}

/** Finished, cancelled, or draft rows may be removed from trip history. */
export function canRemoveFromTripHistory(status: string | null | undefined): boolean {
  return Boolean(status) && !isLiveTripStatus(status)
}

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  DRAFT: 'Draft',
  PICKUP_IN_PROGRESS: 'Pickup in progress',
  IN_TRANSIT: 'In transit',
  DROPOFF_IN_PROGRESS: 'Drop-off in progress',
  DROPPED_OFF: 'Dropped off',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXCEPTION: 'Exception',
}

export const TRIP_STATUS_CHIP: Record<TripStatus, 'ok' | 'warn' | 'err' | 'transit' | 'idle'> = {
  DRAFT: 'idle',
  PICKUP_IN_PROGRESS: 'warn',
  IN_TRANSIT: 'transit',
  DROPOFF_IN_PROGRESS: 'warn',
  DROPPED_OFF: 'ok',
  COMPLETED: 'ok',
  CANCELLED: 'err',
  EXCEPTION: 'err',
}

/** Row-icon glyphs on the trips list — mirrors the design template. */
export const TRIP_STATUS_GLYPH: Record<TripStatus, string> = {
  DRAFT: '–',
  PICKUP_IN_PROGRESS: '▸',
  IN_TRANSIT: '▸',
  DROPOFF_IN_PROGRESS: '▼',
  DROPPED_OFF: '✓',
  COMPLETED: '✓',
  CANCELLED: '✕',
  EXCEPTION: '✕',
}

/** Immutable event vocabulary (spec 5.2/5.3). */
export const EVENT_TYPES = [
  'PICKUP_STARTED',
  'PICKUP_CONFIRMED',
  'DROPOFF_STARTED',
  'DROPOFF_CONFIRMED',
  'GATE_IN',
  'GATE_OUT',
  'ARRIVED',
  'DEPARTED',
  'YARD_MOVE',
  'CHASSIS_ATTACH',
  'CHASSIS_DETACH',
  'LOADED',
  'EMPTIED',
  'DOCUMENT_ADDED',
  'DAMAGE_REPORTED',
  'CORRECTION',
  'STATUS_CHANGE',
  'RELEASED',
  'ACTIVATED',
  'PICKUP_CANCELLED',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  PICKUP_STARTED: 'Pickup started',
  PICKUP_CONFIRMED: 'Picked up',
  DROPOFF_STARTED: 'Drop-off started',
  DROPOFF_CONFIRMED: 'Dropped off',
  GATE_IN: 'Gate in',
  GATE_OUT: 'Gate out',
  ARRIVED: 'Arrived',
  DEPARTED: 'Departed',
  YARD_MOVE: 'Yard move',
  CHASSIS_ATTACH: 'Container placed on chassis',
  CHASSIS_DETACH: 'Container removed from chassis',
  LOADED: 'Loaded',
  EMPTIED: 'Emptied',
  DOCUMENT_ADDED: 'Document added',
  DAMAGE_REPORTED: 'Damage reported',
  CORRECTION: 'Correction',
  STATUS_CHANGE: 'Status change',
  RELEASED: 'Released from network',
  ACTIVATED: 'Added to active pool',
  PICKUP_CANCELLED: 'Pickup cancelled',
}

/** Timeline node glyph — mirrors the design template's custody history rail. */
export const EVENT_GLYPH: Record<EventType, string> = {
  PICKUP_STARTED: '▲',
  PICKUP_CONFIRMED: '▲',
  DROPOFF_STARTED: '▼',
  DROPOFF_CONFIRMED: '▼',
  GATE_IN: '⇥',
  GATE_OUT: '⇤',
  ARRIVED: '◉',
  DEPARTED: '➔',
  YARD_MOVE: '⇄',
  CHASSIS_ATTACH: '⚭',
  CHASSIS_DETACH: '⚮',
  LOADED: '▣',
  EMPTIED: '▢',
  DOCUMENT_ADDED: '▤',
  DAMAGE_REPORTED: '⚠',
  CORRECTION: '✎',
  STATUS_CHANGE: '↻',
  RELEASED: '✓',
  ACTIVATED: '＋',
  PICKUP_CANCELLED: '✕',
}

export const EVENT_SOURCES = ['MANUAL', 'OCR', 'GEOFENCE', 'IMPORT', 'API', 'ADMIN_EDIT', 'SYSTEM'] as const
export type EventSource = (typeof EVENT_SOURCES)[number]

export const LOCATION_TYPES = [
  'COMPANY_YARD',
  'CUSTOMER',
  'MARINE_TERMINAL',
  'RAIL_TERMINAL',
] as const
export type LocationType = (typeof LOCATION_TYPES)[number]

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  COMPANY_YARD: 'Company Yard',
  CUSTOMER: 'Customer Location',
  MARINE_TERMINAL: 'Marine Terminal',
  RAIL_TERMINAL: 'Rail Yard',
}

export const LOCATION_GLYPH: Record<LocationType, string> = {
  COMPANY_YARD: 'P',
  CUSTOMER: '☖',
  MARINE_TERMINAL: '⚓',
  RAIL_TERMINAL: '┼',
}

/**
 * Headers for existing-location lists. The add-location type picker is a
 * flat list — marine terminals and rail yards still sit together here
 * because drivers treat them as the same kind of gate.
 */
export const LOCATION_TYPE_GROUPS = [
  { key: 'company', label: 'Company yards', types: ['COMPANY_YARD'] },
  { key: 'customer', label: 'Customers', types: ['CUSTOMER'] },
  { key: 'terminal', label: 'Marine terminals / Rail yards', types: ['MARINE_TERMINAL', 'RAIL_TERMINAL'] },
] as const

export type LocationTypeGroup = (typeof LOCATION_TYPE_GROUPS)[number]

export function locationTypeGroup(type: LocationType): LocationTypeGroup {
  return LOCATION_TYPE_GROUPS.find(group => (group.types as readonly LocationType[]).includes(type))
    ?? LOCATION_TYPE_GROUPS[0]
}

export function groupLocationsByType<T extends { type: LocationType, isUncategorized?: boolean }>(
  items: T[],
): Array<{ key: string, label: string, items: T[] }> {
  const buckets = new Map<string, { key: string, label: string, items: T[] }>()
  for (const group of LOCATION_TYPE_GROUPS) {
    buckets.set(group.key, { key: group.key, label: group.label, items: [] })
  }
  const leftover: T[] = []
  for (const item of items) {
    if (item.isUncategorized) {
      leftover.push(item)
      continue
    }
    buckets.get(locationTypeGroup(item.type).key)!.items.push(item)
  }
  const grouped = [...buckets.values()].filter(group => group.items.length)
  if (leftover.length) grouped.push({ key: 'other', label: 'Uncategorized', items: leftover })
  return grouped
}

export const DOCUMENT_CATEGORIES = [
  'EIR',
  'POD',
  'BILL_OF_LADING',
  'DELIVERY_ORDER',
  'GATE_TICKET',
  'SCALE_TICKET',
  'DAMAGE_REPORT',
  'REPAIR_INVOICE',
  'CUSTOMS',
  'PHOTO',
  'OTHER',
] as const
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number]

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  EIR: 'EIR / interchange',
  POD: 'Proof of delivery',
  BILL_OF_LADING: 'Bill of lading',
  DELIVERY_ORDER: 'Delivery order',
  GATE_TICKET: 'Gate ticket',
  SCALE_TICKET: 'Scale ticket',
  DAMAGE_REPORT: 'Damage report',
  REPAIR_INVOICE: 'Repair invoice',
  CUSTOMS: 'Customs document',
  PHOTO: 'Photo',
  OTHER: 'Other',
}

export const EXCEPTION_TYPES = [
  'CONTAINER_NOT_FOUND',
  'WRONG_CONTAINER',
  'WRONG_CHASSIS',
  'TERMINAL_REJECTION',
  'CUSTOMER_REFUSAL',
  'DAMAGED_CONTAINER',
  'SEAL_MISMATCH',
  'APPOINTMENT_MISSED',
  'CLOSED_GATE',
  'CUSTOMS_HOLD',
] as const
export type ExceptionType = (typeof EXCEPTION_TYPES)[number]

export const DISPATCH_TASK_KINDS = ['PICKUP', 'DROPOFF', 'LOAD', 'EMPTY', 'WORK', 'NOTE'] as const
export type DispatchTaskKind = (typeof DISPATCH_TASK_KINDS)[number]

export const DISPATCH_TASK_KIND_LABELS: Record<DispatchTaskKind, string> = {
  PICKUP: 'Pickup',
  DROPOFF: 'Drop-off',
  LOAD: 'Live load',
  EMPTY: 'Empty',
  WORK: 'Work',
  NOTE: 'Dispatch',
}

export const DISPATCH_TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'DISMISSED'] as const
export const DISPATCH_TASK_ALL_STATUSES = ['DRAFT', ...DISPATCH_TASK_STATUSES] as const
export type DispatchTaskStatus = (typeof DISPATCH_TASK_ALL_STATUSES)[number]
export type DispatchTaskDriverStatus = (typeof DISPATCH_TASK_STATUSES)[number]

export const DISPATCH_TASK_STATUS_LABELS: Record<DispatchTaskStatus, string> = {
  DRAFT: 'Draft',
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  DISMISSED: 'Dismissed',
}

export const DISPATCH_TASK_STATUS_CHIP: Record<DispatchTaskStatus, 'ok' | 'warn' | 'err' | 'transit' | 'idle'> = {
  DRAFT: 'idle',
  OPEN: 'warn',
  IN_PROGRESS: 'transit',
  DONE: 'ok',
  DISMISSED: 'idle',
}

export const DISPATCH_TASK_SOURCES = ['SMS', 'MANUAL', 'DISPATCH'] as const
export type DispatchTaskSource = (typeof DISPATCH_TASK_SOURCES)[number]

export const DISPATCH_TASK_SOURCE_LABELS: Record<DispatchTaskSource, string> = {
  SMS: 'Dispatch',
  MANUAL: 'Your note',
  DISPATCH: 'Dispatch',
}
