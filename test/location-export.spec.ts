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
  it('matches the yard export layout with combos then bare chassis', () => {
    expect(formatLocationExportList({
      locationName: 'NJ Yard',
      containers: [
        { number: 'BSIU818594', containerType: 'TROPICAL', chassisNumber: 'TRAC 123456' },
        { number: 'ZCSU842461', containerType: 'ZIM', chassisNumber: 'DCLI 784521' },
        { number: 'CMAU718500', containerType: 'CMA', chassisNumber: 'FLEXI 459872' },
        { number: 'KOSU826227', containerType: 'KING_OCEAN', chassisNumber: 'TRAC 337194' },
      ],
      chassis: [
        { number: 'DCLI 628451' },
        { number: 'TRAC 905734' },
        { number: 'FLEXI 218659' },
      ],
    })).toBe([
      'NJ Yard',
      '',
      'Container & chassis combos',
      '1. CT: BSIU818594',
      '   Chassis: TRAC 123456',
      '   Tropical',
      '',
      '2. CT: ZCSU842461',
      '   Chassis: DCLI 784521',
      '   ZIM',
      '',
      '3. CT: CMAU718500',
      '   Chassis: FLEXI 459872',
      '   CMA CGM',
      '',
      '4. CT: KOSU826227',
      '   Chassis: TRAC 337194',
      '   King Ocean',
      '',
      'Bare chassis',
      '1. Chassis: DCLI 628451',
      '2. Chassis: TRAC 905734',
      '3. Chassis: FLEXI 218659',
    ].join('\n'))
  })

  it('lists a container without a chassis and omits an empty bare section', () => {
    expect(formatLocationExportList({
      locationName: 'Jersey Yard',
      containers: [
        { number: 'MSCU4521894', containerType: 'TROPICAL' },
      ],
      chassis: [],
    })).toBe([
      'Jersey Yard',
      '',
      'Container & chassis combos',
      '1. CT: MSCU4521894',
      '   Tropical',
    ].join('\n'))
  })

  it('omits the combo section when only bare chassis are on site', () => {
    expect(formatLocationExportList({
      locationName: 'Jersey Yard',
      containers: [],
      chassis: [{ number: 'TRAC905734' }],
    })).toBe([
      'Jersey Yard',
      '',
      'Bare chassis',
      '1. Chassis: TRAC 905734',
    ].join('\n'))
  })

  it('does not list a chassis that is already under a container', () => {
    expect(formatLocationExportList({
      locationName: 'Jersey Yard',
      containers: [
        { number: 'BSIU818594', containerType: 'TROPICAL', chassisNumber: 'TRAC123456' },
      ],
      chassis: [
        { number: 'TRAC 123456' },
        { number: 'DCLI 628451' },
      ],
    })).toBe([
      'Jersey Yard',
      '',
      'Container & chassis combos',
      '1. CT: BSIU818594',
      '   Chassis: TRAC 123456',
      '   Tropical',
      '',
      'Bare chassis',
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
})
