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

/** Business classification required on every container (spec 5.1). */
export const CONTAINER_TYPES = ['TROPICAL', 'ZIM', 'CMA', 'KING_OCEAN'] as const
export type ContainerType = (typeof CONTAINER_TYPES)[number]

export const CONTAINER_TYPE_LABELS: Record<ContainerType, string> = {
  TROPICAL: 'Tropical',
  ZIM: 'ZIM',
  CMA: 'CMA',
  KING_OCEAN: 'King Ocean',
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

/** Nominal length in feet — drives proportional sizing in the yard editor. */
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
  CANCELLED: 'idle',
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
  PICKUP_CONFIRMED: 'Pickup confirmed',
  DROPOFF_STARTED: 'Drop-off started',
  DROPOFF_CONFIRMED: 'Drop-off confirmed',
  GATE_IN: 'Gate in',
  GATE_OUT: 'Gate out',
  ARRIVED: 'Arrived',
  DEPARTED: 'Departed',
  YARD_MOVE: 'Yard move',
  CHASSIS_ATTACH: 'Chassis attached',
  CHASSIS_DETACH: 'Chassis detached',
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
  'MARINE_TERMINAL',
  'RAIL_TERMINAL',
  'CUSTOMER',
  'WAREHOUSE',
  'COMPANY_YARD',
  'DEPOT',
  'REPAIR_SHOP',
  'STAGING',
  'TEMPORARY',
] as const
export type LocationType = (typeof LOCATION_TYPES)[number]

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  MARINE_TERMINAL: 'Marine terminal',
  RAIL_TERMINAL: 'Rail terminal',
  CUSTOMER: 'Customer',
  WAREHOUSE: 'Warehouse',
  COMPANY_YARD: 'Company yard',
  DEPOT: 'Depot',
  REPAIR_SHOP: 'Repair shop',
  STAGING: 'Staging area',
  TEMPORARY: 'Temporary site',
}

export const LOCATION_GLYPH: Record<LocationType, string> = {
  MARINE_TERMINAL: '▣',
  RAIL_TERMINAL: '▤',
  CUSTOMER: '▤',
  WAREHOUSE: '▦',
  COMPANY_YARD: '◫',
  DEPOT: '▩',
  REPAIR_SHOP: '⚙',
  STAGING: '▬',
  TEMPORARY: '◌',
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

/** 150 air miles expressed in statute miles (spec 14.3). */
export const SHORT_HAUL_RADIUS_MILES = 172.6
/** Duty must end within 14 consecutive hours of reporting for duty. */
export const SHORT_HAUL_WINDOW_MINUTES = 14 * 60
/** Property-carrying CMV drivers need 10 consecutive hours off between tours. */
export const REQUIRED_OFF_DUTY_MINUTES = 10 * 60
