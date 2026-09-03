import type { TripKind } from './domain'

export const PICKUP_STEPS = [
  'kind',
  'location',
  'inventory',
  'equipment',
  'containerType',
  'equipmentType',
  'seal',
  'notes',
  'destination',
  'confirm',
] as const

export type PickupStep = (typeof PICKUP_STEPS)[number]

/**
 * New Pickup wizard. Choosing a box or chassis already at the yard skips
 * typing, classification, chassis, and cargo questions the record already
 * answers. Typed containers carry their loaded/empty state on the equipment
 * screen, and a loaded box still collects a seal number. Destination is
 * always last before confirm so it is not left to Home.
 */
export function pickupSteps(input: {
  kind: TripKind | null
  fromYard: boolean
  manualEntry: boolean
  needsClassification: boolean
  isLoaded: boolean | null
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
    if (input.kind === 'CONTAINER' && input.isLoaded === true && (input.manualEntry || input.fromYard)) {
      steps.push('seal')
    }
    steps.push('notes', 'confirm')
    return steps
  }

  const steps: PickupStep[] = ['kind', 'location', 'inventory']

  if (input.manualEntry && !input.fromYard) {
    steps.push('equipment')
    if (input.kind === 'CONTAINER' && input.needsClassification) {
      steps.push('containerType', 'equipmentType')
    }
  }

  if (input.kind === 'CONTAINER' && input.isLoaded === true && (input.manualEntry || input.fromYard)) {
    steps.push('seal')
  }

  steps.push('notes', 'destination', 'confirm')
  return steps
}
