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
 * New Pickup wizard. Choosing a box or chassis already at the yard skips
 * typing, classification, chassis, and cargo questions the record already
 * answers. Loaded containers still collect a seal number. Destination is
 * always last before confirm so it is not left to Home.
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
  if (input.swap) {
    const steps: PickupStep[] = ['inventory']
    if (input.manualEntry && !input.fromYard) {
      steps.push('equipment')
      if (input.kind === 'CONTAINER' && input.needsClassification) {
        steps.push('containerType', 'equipmentType')
      }
    }
    if (input.kind === 'CONTAINER' && input.isLoaded && (input.manualEntry || input.fromYard)) {
      steps.push('seal')
    }
    steps.push('notes', 'destination', 'confirm')
    return steps
  }

  const steps: PickupStep[] = ['kind', 'location', 'inventory']

  if (input.manualEntry && !input.fromYard) {
    steps.push('equipment')
    if (input.kind === 'CONTAINER' && input.needsClassification) {
      steps.push('containerType', 'equipmentType')
    }
    if (input.kind === 'CONTAINER') {
      steps.push('load')
    }
  }

  if (input.kind === 'CONTAINER' && input.isLoaded && (input.manualEntry || input.fromYard)) {
    steps.push('seal')
  }

  steps.push('notes', 'destination', 'confirm')
  return steps
}
