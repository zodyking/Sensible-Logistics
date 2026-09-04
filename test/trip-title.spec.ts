import { describe, expect, it } from 'vitest'

import {
  applyBareChassisNumbers,
  isBareChassisTrip,
  latestChassisNumberByTrip,
  tripEquipmentTitle,
} from '../shared/utils/trip-title'

describe('tripEquipmentTitle', () => {
  it('leads a container trip with the box number', () => {
    expect(tripEquipmentTitle({
      kind: 'CONTAINER',
      containerNumber: 'BSIU8186558',
      chassisNumber: 'SLSZ123456',
      reference: 'TRP-1041',
    })).toBe('BSIU818655-8')
  })

  it('leads a chassis-only trip with the chassis number, not the trip reference', () => {
    expect(tripEquipmentTitle({
      kind: 'BARE_CHASSIS',
      containerNumber: null,
      chassisNumber: 'SLSZ123456',
      reference: 'TRP-1043',
    })).toBe('SLSZ123456')
  })

  it('still uses the chassis when a completed chassis-only trip has no container', () => {
    expect(tripEquipmentTitle({
      kind: 'BARE_CHASSIS',
      chassisNumber: 'aimz481345',
      reference: 'TRP-1043',
    })).toBe('AIMZ481345')
  })

  it('falls back to the trip reference only when no equipment number is known', () => {
    expect(tripEquipmentTitle({
      kind: 'BARE_CHASSIS',
      reference: 'TRP-1043',
    })).toBe('TRP-1043')
  })
})

describe('isBareChassisTrip', () => {
  it('treats BARE_CHASSIS rows as chassis-only even before the number is joined', () => {
    expect(isBareChassisTrip({ kind: 'BARE_CHASSIS', containerNumber: null })).toBe(true)
  })
})

describe('applyBareChassisNumbers', () => {
  it('fills a missing chassis number on chassis-only trips from event history', () => {
    const filled = applyBareChassisNumbers(
      [{ id: 'trip-1', kind: 'BARE_CHASSIS', chassisNumber: null, reference: 'TRP-1043' }],
      new Map([['trip-1', 'SLSZ123456']]),
    )
    expect(filled[0]?.chassisNumber).toBe('SLSZ123456')
    expect(tripEquipmentTitle(filled[0]!)).toBe('SLSZ123456')
  })

  it('does not overwrite a container trip with a chassis recovered from events', () => {
    const filled = applyBareChassisNumbers(
      [{ id: 'trip-2', kind: 'CONTAINER', chassisNumber: null }],
      new Map([['trip-2', 'SLSZ123456']]),
    )
    expect(filled[0]?.chassisNumber).toBeNull()
  })
})

describe('latestChassisNumberByTrip', () => {
  it('keeps the newest event that still has a chassis number', () => {
    const map = latestChassisNumberByTrip([
      { tripId: 'trip-1', chassisNumber: null },
      { tripId: 'trip-1', chassisNumber: 'SLSZ123456' },
      { tripId: 'trip-1', chassisNumber: 'OLDER000001' },
    ])
    expect(map.get('trip-1')).toBe('SLSZ123456')
  })
})
