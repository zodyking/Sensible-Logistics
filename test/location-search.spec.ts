import { describe, expect, it } from 'vitest'

import { filterLocations, locationMatchesQuery } from '../shared/utils/location-search'

const yard = {
  name: 'Hialeah Yard',
  addressLine1: '2100 W 76th St',
  city: 'Hialeah',
  state: 'FL',
  locationCode: 'HIA-1',
}

describe('locationMatchesQuery', () => {
  it('treats an empty search as a match for every location', () => {
    expect(locationMatchesQuery(yard, '')).toBe(true)
    expect(locationMatchesQuery(yard, '   ')).toBe(true)
  })

  it('matches name, address, city, state, and location code', () => {
    expect(locationMatchesQuery(yard, 'hialeah')).toBe(true)
    expect(locationMatchesQuery(yard, '76th')).toBe(true)
    expect(locationMatchesQuery(yard, 'FL')).toBe(true)
    expect(locationMatchesQuery(yard, 'hia-1')).toBe(true)
  })

  it('rejects a query that hits none of the fields', () => {
    expect(locationMatchesQuery(yard, 'Savannah')).toBe(false)
  })
})

describe('filterLocations', () => {
  const items = [
    yard,
    { name: 'PortMiami', addressLine1: '1007 N America Way', city: 'Miami', state: 'FL', locationCode: 'PEV' },
  ]

  it('returns the full list when the search is empty', () => {
    expect(filterLocations(items, '')).toEqual(items)
  })

  it('keeps only locations that match the search', () => {
    expect(filterLocations(items, 'port').map(item => item.name)).toEqual(['PortMiami'])
  })
})
