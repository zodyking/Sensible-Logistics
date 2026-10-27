import { describe, expect, it } from 'vitest'
import {
  csvCell,
  formatLocationDirectoryCsv,
  locationCsvFileName,
} from '../shared/utils/location-csv'

describe('csvCell', () => {
  it('quotes commas, quotes, and line breaks', () => {
    expect(csvCell('Yard')).toBe('Yard')
    expect(csvCell('12 Main, Suite 4')).toBe('"12 Main, Suite 4"')
    expect(csvCell('He said "go"')).toBe('"He said ""go"""')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
  })
})

describe('locationCsvFileName', () => {
  it('uses a stable date stamp', () => {
    expect(locationCsvFileName(new Date('2026-10-27T12:00:00Z'))).toBe('locations-2026-10-27.csv')
  })
})

describe('formatLocationDirectoryCsv', () => {
  it('writes headers and directory fields', () => {
    const csv = formatLocationDirectoryCsv([
      {
        name: 'Queens Yard',
        type: 'COMPANY_YARD',
        locationCode: 'QY',
        addressLine1: '100 Yard Rd',
        addressLine2: 'Gate B',
        city: 'Jamaica',
        state: 'NY',
        postalCode: '11433',
        mainPhone: '7185550100',
        contactName: 'Alex Rivera',
        contactPhone: '7185550199',
        hours: '06:00-18:00',
        appointmentRequired: true,
        status: 'ACTIVE',
        gateInstructions: 'Use the side gate',
        driverNotes: 'Ask for Alex',
        shipcsxTerminal: null,
        capacity: 40,
      },
    ])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('Name,Type,Code,Address,Address 2,City,State,Postal code')
    expect(csv).toContain('Queens Yard,Company Yard,QY,100 Yard Rd,Gate B,Jamaica,NY,11433,US')
    expect(csv).toContain('(718) 555-0100,Alex Rivera,(718) 555-0199')
    expect(csv).toContain('Yes,Active')
  })
})
