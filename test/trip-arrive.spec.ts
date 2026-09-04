import { describe, expect, it } from 'vitest'

import { describeArrival, isSwapEmptyArrival, keepsChassisAfterContainerDrop } from '../shared/utils/trip-arrive'

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
    })).toBe('This finishes the empty at the customer. The load stays on Home. You keep the chassis. Home will open a chassis-only trip so you can set the next drop-off.')
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
    })).toBe('Yard stop. The container stays here. This trip ends. Container and chassis stay here.')

    expect(describeArrival({
      kind: 'CONTAINER',
      locationType: 'MARINE_TERMINAL',
    })).toBe('The container is returned. This trip ends.')
  })

  it('explains keeping the chassis after dropping only the box', () => {
    expect(describeArrival({
      kind: 'CONTAINER',
      locationType: 'CUSTOMER',
      hasChassis: true,
      retainChassis: false,
    })).toBe('The container stays at the customer to load. This trip ends. You keep the chassis. Home will open a chassis-only trip so you can set the next drop-off.')
  })

  it('covers a bare chassis park', () => {
    expect(describeArrival({
      kind: 'BARE_CHASSIS',
      retainChassis: false,
    })).toBe('The chassis is parked here. This trip ends.')
  })

  it('does not assume chassis stay or unhook before the driver chooses', () => {
    expect(describeArrival({
      kind: 'CONTAINER',
      locationType: 'COMPANY_YARD',
      hasChassis: true,
    })).toBe('Yard stop. The container stays here. This trip ends.')

    expect(describeArrival({
      kind: 'BARE_CHASSIS',
      hasChassis: true,
      retainChassis: null,
    })).toBe('This trip ends here.')
  })

  it('treats drop-container-only as keeping the chassis with the driver', () => {
    expect(keepsChassisAfterContainerDrop({
      kind: 'CONTAINER',
      hasChassis: true,
      retainChassis: false,
    })).toBe(true)
    expect(keepsChassisAfterContainerDrop({
      kind: 'CONTAINER',
      hasChassis: true,
      retainChassis: true,
    })).toBe(false)
    expect(keepsChassisAfterContainerDrop({
      kind: 'BARE_CHASSIS',
      hasChassis: true,
      retainChassis: false,
    })).toBe(false)
  })
})
