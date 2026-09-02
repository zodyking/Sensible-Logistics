import { describe, expect, it } from 'vitest'
import {
  locationIdsSharingAddress,
  locationsShareAddress,
} from '../shared/utils/location-address'

describe('location address matching', () => {
  it('treats the same normalized address as one site', () => {
    expect(locationsShareAddress(
      { id: 'a', normalizedAddress: '100 west 31st st new york ny 10001' },
      { id: 'b', normalizedAddress: '100 west 31st st new york ny 10001' },
    )).toBe(true)
  })

  it('treats Brooklyn vs New York on the same street and ZIP as one site', () => {
    expect(locationsShareAddress(
      { id: 'a', addressLine1: '100 West 31st St', city: 'Brooklyn', state: 'NY', postalCode: '11201' },
      { id: 'b', addressLine1: '100 West 31st St', city: 'New York', state: 'NY', postalCode: '11201' },
    )).toBe(true)
  })

  it('does not merge different streets', () => {
    expect(locationsShareAddress(
      { id: 'a', addressLine1: '10 Main St', city: 'Newark', state: 'NJ', postalCode: '07102' },
      { id: 'b', addressLine1: '20 Main St', city: 'Newark', state: 'NJ', postalCode: '07102' },
    )).toBe(false)
  })

  it('always keeps the destination id when the catalog has no address', () => {
    expect(locationIdsSharingAddress(
      { id: 'dest' },
      [{ id: 'other', addressLine1: '10 Main St', city: 'Newark' }],
    )).toEqual(['dest'])
  })

  it('returns every catalog id that shares the destination address', () => {
    const dest = { id: 'dest', addressLine1: '500 Customer Rd', city: 'Elizabeth', state: 'NJ', postalCode: '07201' }
    expect(locationIdsSharingAddress(dest, [
      dest,
      { id: 'dup', addressLine1: '500 Customer Rd', city: 'Elizabeth', state: 'NJ', postalCode: '07201' },
      { id: 'other', addressLine1: '1 Other Ave', city: 'Elizabeth', state: 'NJ', postalCode: '07201' },
    ]).sort()).toEqual(['dest', 'dup'])
  })
})
