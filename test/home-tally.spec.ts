import { describe, expect, it } from 'vitest'
import { countHomeDayTally } from '../shared/utils/home-tally'
import {
  isNyNjBridgeCross,
  locationStateCode,
  stateFromPostalCode,
  usStateCode,
} from '../shared/utils/us-address'

const ZONE = 'America/New_York'

describe('usStateCode', () => {
  it('normalizes New York and New Jersey', () => {
    expect(usStateCode('New York')).toBe('NY')
    expect(usStateCode('ny')).toBe('NY')
    expect(usStateCode('New Jersey')).toBe('NJ')
    expect(usStateCode('NJ')).toBe('NJ')
  })
})

describe('stateFromPostalCode', () => {
  it('maps NY and NJ ZIP prefixes', () => {
    expect(stateFromPostalCode('11236')).toBe('NY')
    expect(stateFromPostalCode('10001')).toBe('NY')
    expect(stateFromPostalCode('07032')).toBe('NJ')
    expect(stateFromPostalCode('08901-1234')).toBe('NJ')
    expect(stateFromPostalCode('33101')).toBeNull()
  })
})

describe('locationStateCode', () => {
  it('prefers the state field, then ZIP', () => {
    expect(locationStateCode({ state: 'New Jersey', postalCode: '11236' })).toBe('NJ')
    expect(locationStateCode({ state: null, postalCode: '11236' })).toBe('NY')
  })
})

describe('isNyNjBridgeCross', () => {
  it('is true only for NY↔NJ', () => {
    expect(isNyNjBridgeCross('NY', 'NJ')).toBe(true)
    expect(isNyNjBridgeCross('New Jersey', 'New York')).toBe(true)
    expect(isNyNjBridgeCross('NY', 'NY')).toBe(false)
    expect(isNyNjBridgeCross('NY', 'FL')).toBe(false)
    expect(isNyNjBridgeCross('NY', null)).toBe(false)
  })
})

describe('countHomeDayTally', () => {
  it('counts swaps and NY↔NJ dispatches on the company day', () => {
    const today = new Date('2026-08-31T14:00:00.000Z')
    const yesterday = new Date('2026-08-30T14:00:00.000Z')
    const tally = countHomeDayTally([
      {
        id: 'empty',
        createdAt: today,
        pickedUpAt: today,
        swapPairTripId: 'load',
        originState: 'NY',
        destinationState: 'NJ',
      },
      {
        id: 'load',
        createdAt: today,
        pickedUpAt: today,
        swapPairTripId: 'empty',
        originState: 'NJ',
        destinationState: 'NY',
      },
      {
        id: 'local',
        createdAt: today,
        originState: 'NY',
        destinationState: 'NY',
      },
      {
        id: 'old-cross',
        createdAt: yesterday,
        originState: 'NY',
        destinationState: 'NJ',
      },
    ], '2026-08-31', ZONE)

    expect(tally).toEqual({ swaps: 1, bridgeCrosses: 2 })
  })

  it('uses ZIP when state is missing', () => {
    const today = new Date('2026-08-31T18:00:00.000Z')
    const tally = countHomeDayTally([
      {
        id: 'zip-cross',
        createdAt: today,
        originPostalCode: '11236',
        destinationPostalCode: '07032',
      },
    ], '2026-08-31', ZONE)

    expect(tally).toEqual({ swaps: 0, bridgeCrosses: 1 })
  })
})
