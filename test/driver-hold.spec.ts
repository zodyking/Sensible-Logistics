import { describe, expect, it } from 'vitest'
import { containerIsHeldByDriver, driverHoldPrompt } from '../shared/utils/driver-hold'

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
})
