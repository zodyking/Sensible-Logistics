/**
 * Centralised operational vocabulary. UI and server both read from here so
 * statuses are never hard-coded across screens (engineering rule, spec 27.3).
 */

export const ROLES = ['DRIVER', 'ADMIN'] as const
export type Role = (typeof ROLES)[number]

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
  PICKUP_IN_PROGRESS: 'Pickup in progress',
  DRIVER_CUSTODY: 'Driver custody',
  AT_LOCATION: 'At location',
  EXCEPTION: 'Exception',
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
  AT_YARD: 'At yard',
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
 * Location lists and the new-location type picker share these headers.
 * Marine terminals and rail yards sit together because drivers treat them
 * as the same kind of gate: inbound/outbound infrastructure.
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

export const TIMECARD_STATUSES = ['OPEN', 'COMPLETED', 'LOCKED'] as const
export type TimecardStatus = (typeof TIMECARD_STATUSES)[number]

/**
 * Short-haul qualification state for a work date (spec 14.3). QUALIFIED is only
 * ever asserted from recorded data; UNKNOWN is used while a tour is still open.
 */
export const SHORT_HAUL_STATUSES = ['QUALIFIED', 'AT_RISK', 'NOT_AVAILABLE', 'UNKNOWN'] as const
export type ShortHaulStatus = (typeof SHORT_HAUL_STATUSES)[number]

export const SHORT_HAUL_LABELS: Record<ShortHaulStatus, string> = {
  QUALIFIED: 'Short-haul conditions met',
  AT_RISK: 'Approaching the 14-hour limit',
  NOT_AVAILABLE: 'SHORT-HAUL EXCEPTION NOT AVAILABLE FOR THIS DAY',
  UNKNOWN: 'Duty tour in progress',
}

export const CYCLE_TYPES = ['SIXTY_SEVEN', 'SEVENTY_EIGHT'] as const
export type CycleType = (typeof CYCLE_TYPES)[number]

export const CYCLE_LIMITS: Record<CycleType, { days: number, minutes: number, label: string }> = {
  SIXTY_SEVEN: { days: 7, minutes: 60 * 60, label: '60 hours / 7 days' },
  SEVENTY_EIGHT: { days: 8, minutes: 70 * 60, label: '70 hours / 8 days' },
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
export type DispatchTaskStatus = (typeof DISPATCH_TASK_STATUSES)[number]

export const DISPATCH_TASK_STATUS_LABELS: Record<DispatchTaskStatus, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  DISMISSED: 'Dismissed',
}

export const DISPATCH_TASK_STATUS_CHIP: Record<DispatchTaskStatus, 'ok' | 'warn' | 'err' | 'transit' | 'idle'> = {
  OPEN: 'warn',
  IN_PROGRESS: 'transit',
  DONE: 'ok',
  DISMISSED: 'idle',
}

/** 150 air miles expressed in statute miles (spec 14.3). */
export const SHORT_HAUL_RADIUS_MILES = 172.6
/** Duty must end within 14 consecutive hours of reporting for duty. */
export const SHORT_HAUL_WINDOW_MINUTES = 14 * 60
/** Property-carrying CMV drivers need 10 consecutive hours off between tours. */
export const REQUIRED_OFF_DUTY_MINUTES = 10 * 60
