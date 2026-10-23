import { describe, expect, it } from 'vitest'
import {
  formatExportChassis,
  formatLocationExportList,
  toCapitalCase,
  toSentenceCase,
} from '../shared/utils/location-export'

describe('toSentenceCase', () => {
  it('lowercases the rest of a title', () => {
    expect(toSentenceCase('Container & Chassis Combos')).toBe('Container & chassis combos')
    expect(toSentenceCase('Bare Chassis')).toBe('Bare chassis')
  })
})

describe('toCapitalCase', () => {
  it('title-cases words and keeps short acronyms', () => {
    expect(toCapitalCase('king ocean')).toBe('King Ocean')
    expect(toCapitalCase('tropical')).toBe('Tropical')
    expect(toCapitalCase('ZIM')).toBe('ZIM')
    expect(toCapitalCase('chassis')).toBe('Chassis')
  })
})

describe('formatExportChassis', () => {
  it('inserts a space after a compact owner block', () => {
    expect(formatExportChassis('TRAC123456')).toBe('TRAC 123456')
  })

  it('keeps an already-spaced plate', () => {
    expect(formatExportChassis('dcli 784521')).toBe('DCLI 784521')
    expect(formatExportChassis('FLEXI 459872')).toBe('FLEXI 459872')
  })
})

describe('formatLocationExportList', () => {
  it('matches the yard export layout with containers then bare chassis', () => {
    expect(formatLocationExportList({
      locationName: 'NJ Yard',
      containers: [
        { number: 'BSIU818594', containerType: 'TROPICAL', equipmentType: 'DRY_20', chassisNumber: 'TRAC 123456' },
        { number: 'ZCSU842461', containerType: 'ZIM', equipmentType: 'DRY_40', chassisNumber: 'DCLI 784521' },
        { number: 'CMAU718500', containerType: 'CMA', equipmentType: 'HC_40', chassisNumber: 'FLEXI 459872' },
        { number: 'KOSU826227', containerType: 'KING_OCEAN', equipmentType: 'DRY_40', chassisNumber: 'TRAC 337194' },
      ],
      chassis: [
        { number: 'DCLI 628451' },
        { number: 'TRAC 905734' },
        { number: 'FLEXI 218659' },
      ],
    })).toBe([
      'NJ Yard',
      '',
      'Containers',
      '',
      '1. CT: BSIU818594',
      '   Chassis: TRAC 123456',
      '   20ft Tropical',
      '   Empty',
      '',
      '2. CT: ZCSU842461',
      '   Chassis: DCLI 784521',
      '   40ft ZIM',
      '   Empty',
      '',
      '3. CT: CMAU718500',
      '   Chassis: FLEXI 459872',
      '   40ft CMA CGM',
      '   Empty',
      '',
      '4. CT: KOSU826227',
      '   Chassis: TRAC 337194',
      '   40ft King Ocean',
      '   Empty',
      '',
      'Bare Chassis',
      '',
      '1. Chassis: DCLI 628451',
      '2. Chassis: TRAC 905734',
      '3. Chassis: FLEXI 218659',
    ].join('\n'))
  })

  it('lists a container without a chassis and omits an empty bare section', () => {
    expect(formatLocationExportList({
      locationName: 'Jersey Yard',
      containers: [
        { number: 'MSCU4521894', containerType: 'TROPICAL', equipmentType: 'DRY_20' },
      ],
      chassis: [],
    })).toBe([
      'Jersey Yard',
      '',
      'Containers',
      '',
      '1. CT: MSCU4521894',
      '   20ft Tropical',
      '   Empty',
    ].join('\n'))
  })

  it('omits the containers section when only bare chassis are on site', () => {
    expect(formatLocationExportList({
      locationName: 'Jersey Yard',
      containers: [],
      chassis: [{ number: 'TRAC905734' }],
    })).toBe([
      'Jersey Yard',
      '',
      'Bare Chassis',
      '',
      '1. Chassis: TRAC 905734',
    ].join('\n'))
  })

  it('does not list a chassis that is already under a container', () => {
    expect(formatLocationExportList({
      locationName: 'Jersey Yard',
      containers: [
        { number: 'BSIU818594', containerType: 'TROPICAL', equipmentType: 'DRY_20', chassisNumber: 'TRAC123456' },
      ],
      chassis: [
        { number: 'TRAC 123456' },
        { number: 'DCLI 628451' },
      ],
    })).toBe([
      'Jersey Yard',
      '',
      'Containers',
      '',
      '1. CT: BSIU818594',
      '   Chassis: TRAC 123456',
      '   20ft Tropical',
      '   Empty',
      '',
      'Bare Chassis',
      '',
      '1. Chassis: DCLI 628451',
    ].join('\n'))
  })

  it('returns only the location name when the yard is empty', () => {
    expect(formatLocationExportList({
      locationName: 'Jersey Yard',
      containers: [],
      chassis: [],
    })).toBe('Jersey Yard')
  })

  it('lists loaded or empty under the size and type', () => {
    expect(formatLocationExportList({
      locationName: 'Jersey Yard',
      containers: [
        { number: 'MSCU4521894', containerType: 'TROPICAL', equipmentType: 'DRY_20', isLoaded: true },
        { number: 'BSIU818594', containerType: 'ZIM', equipmentType: 'DRY_40', isLoaded: false },
      ],
    })).toBe([
      'Jersey Yard',
      '',
      'Containers',
      '',
      '1. CT: MSCU4521894',
      '   20ft Tropical',
      '   Loaded',
      '',
      '2. CT: BSIU818594',
      '   40ft ZIM',
      '   Empty',
    ].join('\n'))
  })

  it('omits notes unless includeNotes is turned on', () => {
    const input = {
      locationName: 'Jersey Yard',
      containers: [
        { number: 'MSCU4521894', containerType: 'TROPICAL', equipmentType: 'DRY_20' },
      ],
      notes: [
        { body: 'Gate is blocked until Friday', authorName: 'Alex Rivera' },
        { body: 'Need a 40ft chassis', authorName: 'Jordan Lee' },
      ],
    }
    expect(formatLocationExportList(input)).toBe([
      'Jersey Yard',
      '',
      'Containers',
      '',
      '1. CT: MSCU4521894',
      '   20ft Tropical',
      '   Empty',
    ].join('\n'))
    expect(formatLocationExportList({ ...input, includeNotes: true })).toBe([
      'Jersey Yard',
      '',
      'Containers',
      '',
      '1. CT: MSCU4521894',
      '   20ft Tropical',
      '   Empty',
      '',
      'Notes',
      '',
      '1. Gate is blocked until Friday',
      '   Alex Rivera',
      '',
      '2. Need a 40ft chassis',
      '   Jordan Lee',
    ].join('\n'))
  })
})
