import { describe, expect, it } from 'vitest'

import { locationPhoneLines } from '../shared/utils/trip-contacts'

describe('locationPhoneLines', () => {
  it('lists main then secondary with an optional contact name', () => {
    expect(locationPhoneLines({
      name: 'Queens Yard',
      mainPhone: '+19545550100',
      contactPhone: '+19545550110',
      contactName: 'Gate 3',
    })).toEqual([
      { key: 'main', label: 'Main', phone: '+19545550100' },
      { key: 'secondary', label: 'Secondary', phone: '+19545550110', person: 'Gate 3' },
    ])
  })

  it('omits blank lines', () => {
    expect(locationPhoneLines({
      mainPhone: '  ',
      contactPhone: '+13055550140',
    })).toEqual([
      { key: 'secondary', label: 'Secondary', phone: '+13055550140', person: null },
    ])
    expect(locationPhoneLines(null)).toEqual([])
  })
})
