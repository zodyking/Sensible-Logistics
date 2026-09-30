import { describe, expect, it } from 'vitest'
import {
  LOCATION_AUDIT_MAX,
  auditCardBackStage,
  auditCardNextStage,
  auditCardNumbersReady,
  auditCardTitle,
  auditEquipmentIdentityKey,
  auditEquipmentItemFromDraft,
  createAuditEquipmentDraft,
  locationAuditSteps,
  readyAuditAddItems,
} from '../shared/utils/location-audit'
import type { LocationAuditEquipmentDraft } from '../shared/utils/location-audit'

function draft(overrides: Partial<LocationAuditEquipmentDraft>): LocationAuditEquipmentDraft {
  return {
    ...createAuditEquipmentDraft(overrides.kind ?? 'CONTAINER'),
    ...overrides,
  }
}

describe('locationAuditSteps', () => {
  it('starts with the action until one is chosen', () => {
    expect(locationAuditSteps(null)).toEqual(['action'])
  })

  it('checks on-site equipment, then confirm', () => {
    expect(locationAuditSteps('check')).toEqual(['action', 'pick', 'confirm'])
  })

  it('adds equipment with repeating cards, then confirm', () => {
    expect(locationAuditSteps('add')).toEqual(['action', 'equipment', 'confirm'])
  })

  it('moves selected boxes after a destination is picked', () => {
    expect(locationAuditSteps('move')).toEqual(['action', 'pick', 'destination', 'confirm'])
  })

  it('deletes selected boxes after confirm', () => {
    expect(locationAuditSteps('delete')).toEqual(['action', 'pick', 'confirm'])
  })
})

describe('audit equipment cards', () => {
  it('starts by asking kind, with no step marker', () => {
    const card = createAuditEquipmentDraft()
    expect(card.stage).toBe('kind')
    expect(card.kind).toBeNull()
    expect(auditCardTitle(card)).toBe('Equipment')
    expect(auditCardBackStage(card)).toBeNull()
    expect(auditEquipmentItemFromDraft(card)).toBeNull()
  })

  it('advances kind to numbers, then a box to type and size', () => {
    const started = draft({ kind: 'CONTAINER', stage: 'kind' })
    expect(auditCardNextStage(started)).toBe('numbers')
    const numbered = draft({
      kind: 'CONTAINER',
      stage: 'numbers',
      containerNumber: 'MSCU4521894',
    })
    expect(auditCardNumbersReady(numbered)).toBe(true)
    expect(auditCardNextStage(numbered)).toBe('classify')
    expect(auditCardBackStage({ ...numbered, stage: 'classify' })).toBe('numbers')
  })

  it('finishes a bare chassis after the plate, skipping type', () => {
    const card = draft({
      kind: 'BARE_CHASSIS',
      stage: 'numbers',
      chassisNumber: 'AIMZ481345',
    })
    expect(auditCardNextStage(card)).toBe('done')
    expect(auditCardBackStage({ ...card, stage: 'done' })).toBe('numbers')
  })

  it('accepts a box with type, size, and an optional chassis', () => {
    expect(auditEquipmentItemFromDraft(draft({
      containerNumber: 'MSCU4521894',
      chassisNumber: 'TRAC481029',
      containerType: 'TROPICAL',
      equipmentType: 'DRY_40',
    }))).toEqual({
      kind: 'CONTAINER',
      containerNumber: 'MSCU4521894',
      chassisNumber: 'TRAC481029',
      containerType: 'TROPICAL',
      equipmentType: 'DRY_40',
    })
  })

  it('rejects a box until type and size are chosen', () => {
    expect(auditEquipmentItemFromDraft(draft({
      containerNumber: 'MSCU4521894',
      containerType: 'TROPICAL',
    }))).toBeNull()
  })

  it('accepts a bare chassis with a complete plate', () => {
    expect(auditEquipmentItemFromDraft(draft({
      kind: 'BARE_CHASSIS',
      chassisNumber: 'AIMZ481345',
    }))).toEqual({
      kind: 'BARE_CHASSIS',
      chassisNumber: 'AIMZ481345',
    })
  })

  it('skips duplicate markings and caps the ready list', () => {
    const first = draft({
      containerNumber: 'MSCU4521894',
      containerType: 'ZIM',
      equipmentType: 'DRY_20',
    })
    const copy = draft({
      containerNumber: 'MSCU 452189-4',
      containerType: 'CMA',
      equipmentType: 'DRY_40',
    })
    const extra = draft({
      kind: 'BARE_CHASSIS',
      chassisNumber: 'TRAC481029',
    })
    expect(readyAuditAddItems([first, copy, extra])).toEqual([
      {
        kind: 'CONTAINER',
        containerNumber: 'MSCU4521894',
        chassisNumber: null,
        containerType: 'ZIM',
        equipmentType: 'DRY_20',
      },
      {
        kind: 'BARE_CHASSIS',
        chassisNumber: 'TRAC481029',
      },
    ])
  })

  it('keys a box by its ISO number and a chassis by its plate', () => {
    expect(auditEquipmentIdentityKey(draft({ containerNumber: 'MSCU4521894' }))).toBe('CT:MSCU4521894')
    expect(auditEquipmentIdentityKey(draft({
      kind: 'BARE_CHASSIS',
      chassisNumber: 'TRAC481029',
    }))).toBe('CH:TRAC481029')
  })

  it('stops at the audit cap', () => {
    const cards = Array.from({ length: LOCATION_AUDIT_MAX + 3 }, (_, i) => draft({
      kind: 'BARE_CHASSIS',
      chassisNumber: `TRAC${String(481000 + i).padStart(6, '0')}`,
    }))
    expect(readyAuditAddItems(cards)).toHaveLength(LOCATION_AUDIT_MAX)
  })
})
