import { describe, expect, it } from 'vitest'

import {
  formatTripSmsMessage,
  tripSmsAction,
  tripSmsLocationName,
} from '../shared/utils/trip-sms'

describe('tripSmsAction', () => {
  it('uses pickup wording while the box is still in custody', () => {
    expect(tripSmsAction('IN_TRANSIT')).toBe('pickup')
    expect(tripSmsAction('DROPOFF_IN_PROGRESS')).toBe('pickup')
  })

  it('uses drop-off wording after arrive', () => {
    expect(tripSmsAction('DROPPED_OFF')).toBe('dropoff')
    expect(tripSmsAction('COMPLETED')).toBe('dropoff')
  })

  it('is unavailable until pickup is confirmed', () => {
    expect(tripSmsAction('PICKUP_IN_PROGRESS')).toBeNull()
    expect(tripSmsAction('DRAFT')).toBeNull()
    expect(tripSmsAction('CANCELLED')).toBeNull()
    expect(tripSmsAction(null)).toBeNull()
  })
})

describe('tripSmsLocationName', () => {
  it('tags a pickup with the origin, then customer, then destination', () => {
    expect(tripSmsLocationName('pickup', {
      originName: 'Port Everglades Terminal 3',
      destinationName: 'Coastal Tile Imports',
      customer: 'Coastal Tile',
    })).toBe('Port Everglades Terminal 3')

    expect(tripSmsLocationName('pickup', {
      originName: '  ',
      destinationName: 'Coastal Tile Imports',
      customer: 'Coastal Tile',
    })).toBe('Coastal Tile')
  })

  it('tags a drop-off with the destination, then customer, then origin', () => {
    expect(tripSmsLocationName('dropoff', {
      originName: 'Port Everglades Terminal 3',
      destinationName: 'Coastal Tile Imports',
      customer: 'Coastal Tile',
    })).toBe('Coastal Tile Imports')
  })
})

describe('formatTripSmsMessage', () => {
  it('formats a loaded pickup with seal, photos-side fields, and origin', () => {
    expect(formatTripSmsMessage('pickup', {
      isLoaded: true,
      containerNumber: 'MSCU4521894',
      sealNumber: 'SL-778213',
      chassisNumber: 'ABCD123456',
      containerType: 'ZIM',
      originName: 'Port Everglades Terminal 3',
      destinationName: 'Coastal Tile Imports',
    })).toBe([
      'Picked Up Load',
      'CT: MSCU452189-4',
      'Seal: SL-778213',
      'Chassis: ABCD123456',
      'ZIM',
      '@Port Everglades Terminal 3',
    ].join('\n'))
  })

  it('omits the seal line for an empty container even when a value is present', () => {
    expect(formatTripSmsMessage('pickup', {
      isLoaded: false,
      containerNumber: 'TGHU7310040',
      sealNumber: 'SHOULD-NOT-APPEAR',
      chassisNumber: 'WXYZ987654',
      containerType: 'CMA',
      originName: 'Hialeah Empty Depot',
    })).toBe([
      'Picked Up Empty',
      'CT: TGHU731004-0',
      'Chassis: WXYZ987654',
      'CMA',
      '@Hialeah Empty Depot',
    ].join('\n'))
  })

  it('formats arrive as dropped off at the destination and still omits empty seals', () => {
    expect(formatTripSmsMessage('dropoff', {
      isLoaded: false,
      containerNumber: 'HLXU8845605',
      chassisNumber: 'LMNO246810',
      containerType: 'CMA',
      originName: 'Coastal Tile Imports',
      destinationName: 'Hialeah Empty Depot',
    })).toBe([
      'Dropped Off Empty',
      'CT: HLXU884560-5',
      'Chassis: LMNO246810',
      'CMA',
      '@Hialeah Empty Depot',
    ].join('\n'))
  })

  it('keeps a loaded drop-off seal and destination tag', () => {
    expect(formatTripSmsMessage('dropoff', {
      isLoaded: true,
      containerNumber: 'CAIU2984551',
      sealNumber: 'SL-9911',
      chassisNumber: 'TRLR111111',
      containerType: 'TROPICAL',
      destinationName: 'Medley Distribution Center',
    })).toBe([
      'Dropped Off Load',
      'CT: CAIU298455-1',
      'Seal: SL-9911',
      'Chassis: TRLR111111',
      'Tropical',
      '@Medley Distribution Center',
    ].join('\n'))
  })

  it('omits missing optional lines for a bare chassis pickup', () => {
    expect(formatTripSmsMessage('pickup', {
      isLoaded: false,
      chassisNumber: 'CHSS000001',
      originName: 'Sensible Yard — Davie',
    })).toBe([
      'Picked Up Empty',
      'Chassis: CHSS000001',
      '@Sensible Yard — Davie',
    ].join('\n'))
  })
})
