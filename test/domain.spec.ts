import { describe, expect, it } from 'vitest'

import {
  ACTIVE_POOL_CHIP,
  ACTIVE_POOL_LABELS,
  ACTIVE_POOL_STATES,
  CONTAINER_STATUS_CHIP,
  CONTAINER_STATUS_LABELS,
  CONTAINER_STATUSES,
  CONTAINER_TYPE_LABELS,
  CONTAINER_TYPES,
  CYCLE_LIMITS,
  CYCLE_TYPES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  DISPATCH_TASK_KIND_LABELS,
  DISPATCH_TASK_KINDS,
  DISPATCH_TASK_STATUS_CHIP,
  DISPATCH_TASK_STATUS_LABELS,
  DISPATCH_TASK_STATUSES,
  EQUIPMENT_LENGTH_FT,
  EQUIPMENT_TYPE_LABELS,
  EQUIPMENT_TYPE_SHORT,
  EQUIPMENT_TYPES,
  PICKUP_EQUIPMENT_SIZE_LABELS,
  PICKUP_EQUIPMENT_SIZES,
  pickupEquipmentSizeLabel,
  EVENT_GLYPH,
  EVENT_TYPE_LABELS,
  EVENT_TYPES,
  LOCATION_GLYPH,
  LOCATION_TYPE_GROUPS,
  LOCATION_TYPE_LABELS,
  LOCATION_TYPES,
  groupLocationsByType,
  locationTypeGroup,
  REQUIRED_OFF_DUTY_MINUTES,
  ROLES,
  SHORT_HAUL_LABELS,
  SHORT_HAUL_RADIUS_MILES,
  SHORT_HAUL_STATUSES,
  SHORT_HAUL_WINDOW_MINUTES,
  TRIP_KIND_LABELS,
  TRIP_KINDS,
  TRIP_STATUS_CHIP,
  TRIP_STATUS_GLYPH,
  TRIP_STATUS_LABELS,
  TRIP_STATUSES,
  canRemoveFromTripHistory,
  isLiveTripStatus,
} from '../shared/utils/domain'

function expectUnionKeysMatch<T extends string>(
  union: readonly T[],
  ...records: Array<Record<T, unknown>>
) {
  expect(new Set(union).size).toBe(union.length)

  for (const record of records) {
    const keys = Object.keys(record)
    expect([...keys].sort()).toEqual([...union].sort())
  }
}

describe('domain vocabulary integrity', () => {
  it('keeps ACTIVE_POOL_STATES in lockstep with labels and chips', () => {
    expectUnionKeysMatch(ACTIVE_POOL_STATES, ACTIVE_POOL_LABELS, ACTIVE_POOL_CHIP)
  })

  it('keeps CONTAINER_STATUSES in lockstep with labels and chips', () => {
    expectUnionKeysMatch(CONTAINER_STATUSES, CONTAINER_STATUS_LABELS, CONTAINER_STATUS_CHIP)
  })

  it('keeps CONTAINER_TYPES in lockstep with labels', () => {
    expectUnionKeysMatch(CONTAINER_TYPES, CONTAINER_TYPE_LABELS)
  })

  it('keeps EQUIPMENT_TYPES in lockstep with labels and lengths', () => {
    expectUnionKeysMatch(EQUIPMENT_TYPES, EQUIPMENT_TYPE_LABELS, EQUIPMENT_LENGTH_FT, EQUIPMENT_TYPE_SHORT)
  })

  it('limits new-container size picks to 20ft and 40ft', () => {
    expect(PICKUP_EQUIPMENT_SIZES).toEqual(['DRY_20', 'DRY_40'])
    expectUnionKeysMatch(PICKUP_EQUIPMENT_SIZES, PICKUP_EQUIPMENT_SIZE_LABELS)
    for (const size of PICKUP_EQUIPMENT_SIZES) {
      expect(EQUIPMENT_TYPES).toContain(size)
    }
    expect(pickupEquipmentSizeLabel('DRY_20')).toBe('20ft')
    expect(pickupEquipmentSizeLabel('DRY_40')).toBe('40ft')
    expect(pickupEquipmentSizeLabel('HC_40')).toBe('40ft')
    expect(pickupEquipmentSizeLabel('TANK')).toBe('20ft')
  })

  it('keeps TRIP_KINDS in lockstep with labels', () => {
    expectUnionKeysMatch(TRIP_KINDS, TRIP_KIND_LABELS)
  })

  it('keeps TRIP_STATUSES in lockstep with labels and chips', () => {
    expectUnionKeysMatch(TRIP_STATUSES, TRIP_STATUS_LABELS, TRIP_STATUS_CHIP, TRIP_STATUS_GLYPH)
  })

  it('lets finished trips leave history and keeps live ones', () => {
    expect(isLiveTripStatus('IN_TRANSIT')).toBe(true)
    expect(canRemoveFromTripHistory('IN_TRANSIT')).toBe(false)
    expect(canRemoveFromTripHistory('COMPLETED')).toBe(true)
    expect(canRemoveFromTripHistory('DROPPED_OFF')).toBe(true)
    expect(canRemoveFromTripHistory('CANCELLED')).toBe(true)
    expect(canRemoveFromTripHistory(null)).toBe(false)
  })

  it('keeps EVENT_TYPES in lockstep with labels and glyphs', () => {
    expectUnionKeysMatch(EVENT_TYPES, EVENT_TYPE_LABELS, EVENT_GLYPH)
  })

  it('keeps LOCATION_TYPES in lockstep with labels and glyphs', () => {
    expectUnionKeysMatch(LOCATION_TYPES, LOCATION_TYPE_LABELS, LOCATION_GLYPH)
  })

  it('covers every location type in the grouped list headers', () => {
    const covered = LOCATION_TYPE_GROUPS.flatMap(group => [...group.types])
    expect([...covered].sort()).toEqual([...LOCATION_TYPES].sort())
  })

  it('groups marine terminals with rail yards and leaves other types alone', () => {
    const grouped = groupLocationsByType([
      { id: '1', type: 'CUSTOMER' as const },
      { id: '2', type: 'MARINE_TERMINAL' as const },
      { id: '3', type: 'RAIL_TERMINAL' as const },
      { id: '4', type: 'COMPANY_YARD' as const },
      { id: '5', type: 'CUSTOMER' as const, isUncategorized: true },
    ])
    expect(grouped.map(group => group.label)).toEqual([
      'Company yards',
      'Customers',
      'Marine terminals / Rail yards',
      'Uncategorized',
    ])
    expect(grouped[2]?.items.map(item => item.id)).toEqual(['2', '3'])
    expect(locationTypeGroup('RAIL_TERMINAL').key).toBe('terminal')
  })

  it('keeps SHORT_HAUL_STATUSES in lockstep with labels', () => {
    expectUnionKeysMatch(SHORT_HAUL_STATUSES, SHORT_HAUL_LABELS)
  })

  it('keeps DOCUMENT_CATEGORIES in lockstep with labels', () => {
    expectUnionKeysMatch(DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS)
  })

  it('keeps DISPATCH_TASK_KINDS in lockstep with labels', () => {
    expectUnionKeysMatch(DISPATCH_TASK_KINDS, DISPATCH_TASK_KIND_LABELS)
  })

  it('keeps DISPATCH_TASK_STATUSES in lockstep with labels and chips', () => {
    expectUnionKeysMatch(DISPATCH_TASK_STATUSES, DISPATCH_TASK_STATUS_LABELS, DISPATCH_TASK_STATUS_CHIP)
  })

  it('keeps CYCLE_TYPES in lockstep with CYCLE_LIMITS', () => {
    expectUnionKeysMatch(CYCLE_TYPES, CYCLE_LIMITS)
  })

  it('defines ROLES as DRIVER and ADMIN', () => {
    expect(ROLES).toEqual(['DRIVER', 'ADMIN'])
  })

  it('exposes the documented FMCSA constants', () => {
    expect(SHORT_HAUL_RADIUS_MILES).toBe(172.6)
    expect(SHORT_HAUL_WINDOW_MINUTES).toBe(840)
    expect(REQUIRED_OFF_DUTY_MINUTES).toBe(600)
    expect(CYCLE_LIMITS.SIXTY_SEVEN.minutes).toBe(3600)
    expect(CYCLE_LIMITS.SEVENTY_EIGHT.minutes).toBe(4200)
  })
})
