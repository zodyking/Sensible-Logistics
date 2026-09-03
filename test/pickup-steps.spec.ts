import { describe, expect, it } from 'vitest'
import { pickupSteps } from '../shared/utils/pickup-steps'

describe('pickupSteps', () => {
  it('keeps destination last before confirm on every path', () => {
    const selected = pickupSteps({
      kind: 'CONTAINER',
      fromYard: true,
      manualEntry: false,
      needsClassification: false,
      isLoaded: true,
    })
    const typed = pickupSteps({
      kind: 'CONTAINER',
      fromYard: false,
      manualEntry: true,
      needsClassification: true,
      isLoaded: true,
    })
    const chassis = pickupSteps({
      kind: 'BARE_CHASSIS',
      fromYard: true,
      manualEntry: false,
      needsClassification: false,
      isLoaded: false,
    })

    expect(selected.slice(-2)).toEqual(['destination', 'confirm'])
    expect(typed.slice(-2)).toEqual(['destination', 'confirm'])
    expect(chassis.slice(-2)).toEqual(['destination', 'confirm'])
  })

  it('skips typing, chassis, and load when a yard record is chosen', () => {
    const steps = pickupSteps({
      kind: 'CONTAINER',
      fromYard: true,
      manualEntry: false,
      needsClassification: true,
      isLoaded: true,
    })
    expect(steps).toEqual(['kind', 'location', 'inventory', 'seal', 'notes', 'destination', 'confirm'])
  })

  it('requires a seal for a loaded yard container and skips it when empty', () => {
    const loaded = pickupSteps({
      kind: 'CONTAINER',
      fromYard: true,
      manualEntry: false,
      needsClassification: false,
      isLoaded: true,
    })
    const empty = pickupSteps({
      kind: 'CONTAINER',
      fromYard: true,
      manualEntry: false,
      needsClassification: false,
      isLoaded: false,
    })
    expect(loaded).toContain('seal')
    expect(empty).not.toContain('seal')
  })

  it('asks for type, size, and seal only when the number is typed', () => {
    const steps = pickupSteps({
      kind: 'CONTAINER',
      fromYard: false,
      manualEntry: true,
      needsClassification: true,
      isLoaded: true,
    })
    expect(steps).toContain('equipment')
    expect(steps).toContain('containerType')
    expect(steps).toContain('seal')
  })

  it('carries loaded or empty on the equipment screen instead of its own step', () => {
    const steps = pickupSteps({
      kind: 'CONTAINER',
      fromYard: false,
      manualEntry: true,
      needsClassification: false,
      isLoaded: false,
    })
    expect(steps).toEqual(['kind', 'location', 'inventory', 'equipment', 'notes', 'destination', 'confirm'])
  })

  it('does not show the typewriter path until the driver chooses enter-unlisted', () => {
    const steps = pickupSteps({
      kind: 'BARE_CHASSIS',
      fromYard: false,
      manualEntry: false,
      needsClassification: false,
      isLoaded: false,
    })
    expect(steps).toEqual(['kind', 'location', 'inventory', 'notes', 'destination', 'confirm'])
  })

  it('omits the seal until the driver marks the box as loaded', () => {
    const unset = pickupSteps({
      kind: 'CONTAINER',
      fromYard: false,
      manualEntry: true,
      needsClassification: true,
      isLoaded: null,
    })
    const unsetKind = pickupSteps({
      kind: null,
      fromYard: false,
      manualEntry: false,
      needsClassification: false,
      isLoaded: null,
    })
    expect(unset).not.toContain('seal')
    expect(unset).toEqual([
      'kind',
      'location',
      'inventory',
      'equipment',
      'containerType',
      'equipmentType',
      'notes',
      'destination',
      'confirm',
    ])
    expect(unsetKind).toEqual(['kind', 'location', 'inventory', 'notes', 'destination', 'confirm'])
  })

  it('starts a swap at on-site inventory and never asks for a location', () => {
    const yard = pickupSteps({
      kind: 'CONTAINER',
      fromYard: true,
      manualEntry: false,
      needsClassification: false,
      isLoaded: true,
      swap: true,
    })
    const typed = pickupSteps({
      kind: 'CONTAINER',
      fromYard: false,
      manualEntry: true,
      needsClassification: true,
      isLoaded: true,
      swap: true,
    })
    expect(yard).toEqual(['inventory', 'seal', 'notes', 'confirm'])
    expect(typed[0]).toBe('inventory')
    expect(typed).not.toContain('kind')
    expect(typed).not.toContain('location')
    expect(typed).not.toContain('destination')
    expect(typed.slice(-2)).toEqual(['notes', 'confirm'])
  })

  it('keeps the drop-off step on a plain pickup', () => {
    const steps = pickupSteps({
      kind: 'CONTAINER',
      fromYard: true,
      manualEntry: false,
      needsClassification: false,
      isLoaded: true,
    })
    expect(steps.slice(-2)).toEqual(['destination', 'confirm'])
  })
})
