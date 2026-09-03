import { describe, expect, it } from 'vitest'
import {
  displayNameFromPhoton,
  formatAddressSearchQuery,
  formatCityStateZip,
  localityFromPhoton,
  parseUsAddressQuery,
  streetLineFromPhoton,
} from '../shared/utils/us-address'

describe('localityFromPhoton', () => {
  it('uses the NYC borough instead of the city name New York', () => {
    expect(localityFromPhoton({
      city: 'New York',
      district: 'Brooklyn',
      county: 'Kings County',
      state: 'New York',
    })).toBe('Brooklyn')
  })

  it('maps Kings County to Brooklyn when district is a neighborhood', () => {
    expect(localityFromPhoton({
      city: 'New York',
      district: 'Canarsie',
      county: 'Kings',
      state: 'NY',
    })).toBe('Brooklyn')
  })

  it('maps the other boroughs from county', () => {
    expect(localityFromPhoton({ city: 'New York', county: 'New York County', state: 'New York' })).toBe('Manhattan')
    expect(localityFromPhoton({ city: 'New York', county: 'Queens County', state: 'New York' })).toBe('Queens')
    expect(localityFromPhoton({ city: 'New York', district: 'The Bronx', state: 'New York' })).toBe('Bronx')
    expect(localityFromPhoton({ city: 'New York', county: 'Richmond County', state: 'New York' })).toBe('Staten Island')
  })

  it('leaves non-NYC cities alone', () => {
    expect(localityFromPhoton({ city: 'Miami', county: 'Miami-Dade', state: 'Florida' })).toBe('Miami')
    expect(localityFromPhoton({ city: 'Yonkers', county: 'Westchester', state: 'New York' })).toBe('Yonkers')
  })
})

describe('NYC mailing line', () => {
  const fosterAve = {
    name: 'Foster Avenue',
    street: 'Foster Avenue',
    city: 'New York',
    district: 'Brooklyn',
    county: 'Kings County',
    state: 'New York',
    postcode: '11236',
  }

  it('formats Brooklyn as written, not New York, New York', () => {
    expect(displayNameFromPhoton(fosterAve, '8202 Foster Ave, Brooklyn, NY 11236'))
      .toBe('8202 Foster Avenue, Brooklyn, NY 11236')
    expect(formatCityStateZip('Brooklyn', 'New York', '11236')).toBe('Brooklyn, NY 11236')
    expect(formatAddressSearchQuery({
      addressLine1: '8202 Foster Ave',
      city: 'Brooklyn',
      state: 'NY',
      postalCode: '11236',
    })).toBe('8202 Foster Ave, Brooklyn, NY 11236')
  })

  it('keeps the house number from the typed query when Photon omits it', () => {
    expect(streetLineFromPhoton(fosterAve, '8202 Foster Ave, Brooklyn, NY 11236'))
      .toBe('8202 Foster Avenue')
  })
})

describe('parseUsAddressQuery', () => {
  it('splits a typed NYC mailing line without an autocomplete pick', () => {
    expect(parseUsAddressQuery('8202 Foster Ave, Brooklyn, NY 11236')).toEqual({
      addressLine1: '8202 Foster Ave',
      city: 'Brooklyn',
      state: 'NY',
      postalCode: '11236',
    })
  })

  it('splits a Florida line', () => {
    expect(parseUsAddressQuery('1850 Eller Drive, Fort Lauderdale, FL 33316')).toEqual({
      addressLine1: '1850 Eller Drive',
      city: 'Fort Lauderdale',
      state: 'FL',
      postalCode: '33316',
    })
  })

  it('saves a name-only line as the street', () => {
    expect(parseUsAddressQuery('Port Everglades Terminal 3')).toEqual({
      addressLine1: 'Port Everglades Terminal 3',
      city: null,
      state: null,
      postalCode: null,
    })
  })
})
