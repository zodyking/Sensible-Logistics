/**
 * Driver-day workflow vocabulary.
 *
 * A Sensible day starts and ends at a company yard. The driver is either idle,
 * hooked to a container while still sitting at a location ("Connected to
 * {name}"), rolling, or stopped and choosing drop-off vs swap. Phases are
 * derived from live trip status + hooked-at-location — not a new trip enum.
 */

import {
  ACTIVE_POOL_LABELS,
  DOCUMENT_CATEGORY_LABELS,
  LOCATION_GLYPH,
  LOCATION_TYPE_LABELS,
} from './domain'
import type {
  ActivePoolState,
  DocumentCategory,
  LocationType,
  TripStatus,
} from './domain'

export const DRIVER_PHASES = [
  'idle',
  'connected',
  'pickup_in_progress',
  'in_transit',
  'at_stop',
] as const
export type DriverPhase = (typeof DRIVER_PHASES)[number]

export const DRIVER_PHASE_LABELS: Record<DriverPhase, string> = {
  idle: 'Ready at yard',
  connected: 'Connected',
  pickup_in_progress: 'Pickup in progress',
  in_transit: 'In transit',
  at_stop: 'At stop',
}

/** Status shown on hooked equipment: "Connected to Marcus Vega". */
export function connectedStatusLabel(fullName: string): string {
  const name = fullName.trim()
  return name ? `Connected to ${name}` : 'Connected'
}

/**
 * Derive the dashboard phase from the live movement (if any) and whether the
 * driver is still physically at a location with a container hooked.
 */
export function deriveDriverPhase(input: {
  liveTripStatus: TripStatus | null
  hookedAtLocation: boolean
}): DriverPhase {
  const status = input.liveTripStatus
  if (status === 'PICKUP_IN_PROGRESS') return 'pickup_in_progress'
  if (status === 'IN_TRANSIT') return 'in_transit'
  if (status === 'DROPOFF_IN_PROGRESS') return 'at_stop'
  if (input.hookedAtLocation) return 'connected'
  return 'idle'
}

/** Human status for a container row / chip, including overnight hook. */
export function custodyStatusLabel(input: {
  activePoolState: ActivePoolState
  driverName?: string | null
  locationName?: string | null
}): string {
  if (input.activePoolState === 'DRIVER_CUSTODY' && input.driverName && input.locationName) {
    return connectedStatusLabel(input.driverName)
  }
  if (input.activePoolState === 'DRIVER_CUSTODY' && input.driverName) {
    return `In transit with ${input.driverName}`
  }
  if (input.locationName) return `At ${input.locationName}`
  return ACTIVE_POOL_LABELS[input.activePoolState]
}

export const LOCATION_LANES = [
  {
    id: 'rail',
    types: ['RAIL_TERMINAL'] as const,
    title: 'CSX / rail yards',
    blurb: 'Drop an empty, pick an inbound load',
  },
  {
    id: 'marine',
    types: ['MARINE_TERMINAL'] as const,
    title: 'Marine terminals',
    blurb: 'Port gates, EIRs and delivery orders',
  },
  {
    id: 'yard',
    types: ['COMPANY_YARD', 'DEPOT', 'STAGING'] as const,
    title: 'Company yards',
    blurb: 'Day starts and ends here',
  },
  {
    id: 'customer',
    types: ['CUSTOMER', 'WAREHOUSE'] as const,
    title: 'Customer locations',
    blurb: 'Deliveries, pickups and swaps',
  },
] as const

export type LocationLaneId = (typeof LOCATION_LANES)[number]['id']

export function laneForLocationType(type: LocationType): (typeof LOCATION_LANES)[number] | null {
  return LOCATION_LANES.find(lane => (lane.types as readonly string[]).includes(type)) ?? null
}

export interface DocumentRequirement {
  category: DocumentCategory
  label: string
  required: boolean
  hint: string
}

/**
 * Paper the driver is expected to capture at a swap / interchange, keyed by
 * where the swap happened.
 */
export function documentChecklistForLocation(type: LocationType): DocumentRequirement[] {
  switch (type) {
    case 'RAIL_TERMINAL':
      return [
        item('GATE_TICKET', true, 'TIR / rail interchange ticket'),
        item('EIR', true, 'Equipment interchange receipt'),
        item('PHOTO', true, 'All four sides plus seal if loaded'),
      ]
    case 'MARINE_TERMINAL':
      return [
        item('EIR', true, 'Terminal interchange / EIR'),
        item('DELIVERY_ORDER', true, 'Steamship delivery order'),
        item('PHOTO', false, 'Gate photos if the clerk asks'),
      ]
    case 'CUSTOMER':
    case 'WAREHOUSE':
      return [
        item('POD', true, 'Signed proof of delivery'),
        item('BILL_OF_LADING', false, 'BOL if the receiver provides one'),
        item('PHOTO', false, 'Dock photos and seal'),
      ]
    case 'COMPANY_YARD':
    case 'DEPOT':
    case 'STAGING':
      return [
        item('PHOTO', false, 'Yard photos of the hooked box'),
      ]
    default:
      return [
        item('GATE_TICKET', false, 'Gate or interchange ticket'),
        item('PHOTO', false, 'Photos of the equipment'),
      ]
  }
}

export function missingDocumentCategories(
  checklist: DocumentRequirement[],
  uploaded: readonly DocumentCategory[],
): DocumentCategory[] {
  const have = new Set(uploaded)
  return checklist.filter(row => row.required && !have.has(row.category)).map(row => row.category)
}

export function greetingForHour(hour: number): 'Good morning' | 'Good afternoon' | 'Good evening' {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export interface DashboardAction {
  id: string
  label: string
  kind: string
  to?: string
}

export function locationLaneGlyph(type: LocationType): string {
  return LOCATION_GLYPH[type]
}

export function locationLaneTitle(type: LocationType): string {
  return LOCATION_TYPE_LABELS[type]
}

function item(category: DocumentCategory, required: boolean, hint: string): DocumentRequirement {
  return {
    category,
    label: DOCUMENT_CATEGORY_LABELS[category],
    required,
    hint,
  }
}
