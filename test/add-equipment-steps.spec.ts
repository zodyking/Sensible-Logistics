import { describe, expect, it } from 'vitest'
import { addEquipmentSteps } from '../shared/utils/add-equipment-steps'

describe('addEquipmentSteps', () => {
  it('asks for a seal when a loaded container is added', () => {
    const steps = addEquipmentSteps({
      kind: 'CONTAINER',
      needsClassification: true,
      isLoaded: true,
    })
    expect(steps).toEqual([
      'kind',
      'equipment',
      'containerType',
      'equipmentType',
      'seal',
      'confirm',
    ])
  })

  it('skips the seal when the box is empty', () => {
    const steps = addEquipmentSteps({
      kind: 'CONTAINER',
      needsClassification: true,
      isLoaded: false,
    })
    expect(steps).toEqual(['kind', 'equipment', 'containerType', 'equipmentType', 'confirm'])
    expect(steps).not.toContain('seal')
  })

  it('skips type and size when the number already exists', () => {
    const steps = addEquipmentSteps({
      kind: 'CONTAINER',
      needsClassification: false,
      isLoaded: true,
    })
    expect(steps).toEqual(['kind', 'equipment', 'seal', 'confirm'])
  })

  it('does not ask for a seal on a bare chassis', () => {
    const steps = addEquipmentSteps({
      kind: 'BARE_CHASSIS',
      needsClassification: false,
      isLoaded: null,
    })
    expect(steps).toEqual(['kind', 'equipment', 'confirm'])
  })

  it('omits the seal until Load is chosen', () => {
    const steps = addEquipmentSteps({
      kind: 'CONTAINER',
      needsClassification: true,
      isLoaded: null,
    })
    expect(steps).not.toContain('seal')
  })
})
