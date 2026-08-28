import { describe, expect, it } from 'vitest'

import { describeArrival, isSwapEmptyArrival } from '../shared/utils/trip-arrive'

describe('isSwapEmptyArrival', () => {
  it('is the empty side of an open customer swap', () => {
    expect(isSwapEmptyArrival({
      kind: 'CONTAINER',
      isLoaded: false,
      swapPairTripId: 'load-trip',
    })).toBe(true)
  })

  it('ignores loads, bare chassis, and unpaired empties', () => {
    expect(isSwapEmptyArrival({
      kind: 'CONTAINER',
      isLoaded: true,
      swapPairTripId: 'pair',
    })).toBe(false)
    expect(isSwapEmptyArrival({
      kind: 'BARE_CHASSIS',
      isLoaded: false,
      swapPairTripId: 'pair',
    })).toBe(false)
    expect(isSwapEmptyArrival({
      kind: 'CONTAINER',
      isLoaded: false,
    })).toBe(false)
  })
})

describe('describeArrival', () => {
  it('tells the driver the empty finishes and the load stays on Home', () => {
    expect(describeArrival({
      kind: 'CONTAINER',
      isLoaded: false,
      swapPairTripId: 'load-trip',
      locationType: 'CUSTOMER',
      hasChassis: true,
      retainChassis: false,
    })).toBe('This finishes the empty at the customer. The load stays on Home. Chassis is unhooked here.')
  })

  it('explains a customer, yard, and terminal drop-off without extra steps', () => {
    expect(describeArrival({
      kind: 'CONTAINER',
      locationType: 'CUSTOMER',
    })).toBe('The container stays at the customer to load. This trip ends.')

    expect(describeArrival({
      kind: 'CONTAINER',
      locationType: 'COMPANY_YARD',
      hasChassis: true,
      retainChassis: true,
    })).toBe('Yard stop. The container stays here. This trip ends. Chassis stays on the box.')

    expect(describeArrival({
      kind: 'CONTAINER',
      locationType: 'MARINE_TERMINAL',
    })).toBe('The container is returned. This trip ends.')
  })

  it('covers a bare chassis park', () => {
    expect(describeArrival({
      kind: 'BARE_CHASSIS',
      retainChassis: false,
    })).toBe('The chassis is parked here. This trip ends.')
  })
})
