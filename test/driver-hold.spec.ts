import { describe, expect, it } from 'vitest'
import { containerHasDriverClaim, containerIsHeldByDriver, driverHoldPrompt, resolutionReportsDriverHold } from '../shared/utils/driver-hold'

describe('driverHoldPrompt', () => {
  it('names the driver and container on the release sheet', () => {
    expect(driverHoldPrompt('Marcus Hale', 'SEKU6617190')).toBe(
      'Marcus Hale currently has SEKU661719-0. Release it and add it here?',
    )
  })

  it('falls back when the name or number is missing', () => {
    expect(driverHoldPrompt('')).toBe(
      'Another driver currently has this container. Release it and add it here?',
    )
    expect(driverHoldPrompt('Jane Doe')).toBe(
      'Jane Doe currently has this container. Release it and add it here?',
    )
  })
})

describe('containerIsHeldByDriver', () => {
  it('treats live claims as held', () => {
    expect(containerIsHeldByDriver('DRIVER_CUSTODY')).toBe(true)
    expect(containerIsHeldByDriver('PICKUP_IN_PROGRESS')).toBe(true)
    expect(containerIsHeldByDriver('AT_LOCATION')).toBe(false)
  })

  it('reports a hold even when the driver id was cleared', () => {
    expect(resolutionReportsDriverHold('DRIVER_CUSTODY')).toBe(true)
    expect(resolutionReportsDriverHold('AT_LOCATION')).toBe(false)
  })

  it('reports leftover driver or live-trip claims at a yard', () => {
    expect(containerHasDriverClaim({
      activePoolState: 'AT_LOCATION',
      currentDriverId: 'drv-1',
      activeMovementId: 'trip-1',
    })).toBe(true)
    expect(resolutionReportsDriverHold('AT_LOCATION', {
      currentDriverId: 'drv-1',
      activeMovementId: null,
    })).toBe(true)
    expect(containerHasDriverClaim({
      activePoolState: 'AT_LOCATION',
      currentDriverId: null,
      activeMovementId: null,
    })).toBe(false)
  })
})
