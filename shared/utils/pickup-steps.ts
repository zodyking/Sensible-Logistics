import type { TripKind } from './domain'

export const PICKUP_STEPS = [
  'kind',
  'location',
  'inventory',
  'equipment',
  'containerType',
  'equipmentType',
  'load',
  'seal',
  'notes',
  'destination',
  'confirm',
] as const

export type PickupStep = (typeof PICKUP_STEPS)[number]

/**
 * New Pickup wizard. A box already at the yard skips typing the container
 * number and classification. Chassis and loaded/empty still get asked, the
 * same as the scan path. Loaded containers still collect a seal. Destination
 * is always last before confirm so it is not left to Home.
 */
export function pickupSteps(input: {
  kind: TripKind
  fromYard: boolean
  manualEntry: boolean
  needsClassification: boolean
  isLoaded: boolean
  /** Second pickup of a load while an empty is still inbound to a customer. */
  swap?: boolean
}): PickupStep[] {
  const steps: PickupStep[] = input.swap ? ['inventory'] : ['kind', 'location', 'inventory']
  const typed = input.manualEntry && !input.fromYard
  const container = input.kind === 'CONTAINER'

  if (typed || (container && (input.fromYard || input.swap))) {
    steps.push('equipment')
    if (typed && container && input.needsClassification) {
      steps.push('containerType', 'equipmentType')
    }
  }

  if (container && !input.swap && (typed || input.fromYard)) {
    steps.push('load')
  }

  if (container && input.isLoaded && (typed || input.fromYard || input.swap)) {
    steps.push('seal')
  }

  steps.push('notes', 'destination', 'confirm')
  return steps
}
