import { describe, expect, it } from 'vitest'
import { containerIsHeldByDriver, driverHoldPrompt, resolutionReportsDriverHold } from '../shared/utils/driver-hold'

describe('driverHoldPrompt', () => {
  it('names the driver on the release sheet', () => {
    expect(driverHoldPrompt('Jane Doe')).toBe(
      'This container is attached to Jane Doe. Would you like to release it?',
    )
  })

  it('falls back when the name is missing', () => {
    expect(driverHoldPrompt('')).toBe('This container is attached to a driver. Would you like to release it?')
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
})
