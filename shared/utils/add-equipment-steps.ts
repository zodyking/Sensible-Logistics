import type { TripKind } from './domain'

export const ADD_EQUIPMENT_STEPS = [
  'kind',
  'equipment',
  'containerType',
  'equipmentType',
  'seal',
  'confirm',
] as const

export type AddEquipmentStep = (typeof ADD_EQUIPMENT_STEPS)[number]

/**
 * Add Equipment wizard at a location. A loaded box collects a seal the same
 * way New Pickup and attach do — Empty skips that step.
 */
export function addEquipmentSteps(input: {
  kind: TripKind | null
  needsClassification: boolean
  isLoaded: boolean | null
}): AddEquipmentStep[] {
  const steps: AddEquipmentStep[] = ['kind', 'equipment']
  if (input.kind === 'CONTAINER' && input.needsClassification) {
    steps.push('containerType', 'equipmentType')
  }
  if (input.kind === 'CONTAINER' && input.isLoaded === true) {
    steps.push('seal')
  }
  steps.push('confirm')
  return steps
}
