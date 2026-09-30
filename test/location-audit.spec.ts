import { describe, expect, it } from 'vitest'
import {
  LOCATION_AUDIT_MAX,
  locationAuditSteps,
  parseBulkContainerNumbers,
} from '../shared/utils/location-audit'

describe('locationAuditSteps', () => {
  it('starts with the action until one is chosen', () => {
    expect(locationAuditSteps(null)).toEqual(['action'])
  })

  it('adds boxes with a pasted list, type, size, then confirm', () => {
    expect(locationAuditSteps('add')).toEqual([
      'action',
      'numbers',
      'containerType',
      'equipmentType',
      'confirm',
    ])
  })

  it('moves selected boxes after a destination is picked', () => {
    expect(locationAuditSteps('move')).toEqual(['action', 'pick', 'destination', 'confirm'])
  })

  it('deletes selected boxes after confirm', () => {
    expect(locationAuditSteps('delete')).toEqual(['action', 'pick', 'confirm'])
  })
})

describe('parseBulkContainerNumbers', () => {
  it('splits mixed separators and keeps unique ISO markings', () => {
    expect(parseBulkContainerNumbers('MSCU4521894\nTCLU1234567, MSCU452189-4;  bad')).toEqual({
      numbers: ['MSCU4521894', 'TCLU1234567'],
      invalid: ['BAD'],
    })
  })

  it('returns nothing for an empty paste', () => {
    expect(parseBulkContainerNumbers('  \n  ')).toEqual({ numbers: [], invalid: [] })
  })

  it('caps the list so an audit stays fast', () => {
    const lines = Array.from({ length: LOCATION_AUDIT_MAX + 5 }, (_, i) =>
      `MSCU${String(100000 + i).padStart(6, '0')}0`)
    const parsed = parseBulkContainerNumbers(lines.join('\n'))
    expect(parsed.numbers).toHaveLength(LOCATION_AUDIT_MAX)
  })
})
