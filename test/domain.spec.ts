import { describe, expect, it } from 'vitest'

import {
  ACTIVE_POOL_CHIP,
  ACTIVE_POOL_LABELS,
  ACTIVE_POOL_STATES,
  CONTAINER_TYPE_LABELS,
  CONTAINER_TYPES,
  CYCLE_LIMITS,
  CYCLE_TYPES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  EQUIPMENT_LENGTH_FT,
  EQUIPMENT_TYPE_LABELS,
  EQUIPMENT_TYPES,
  EVENT_GLYPH,
  EVENT_TYPE_LABELS,
  EVENT_TYPES,
  LOCATION_GLYPH,
  LOCATION_TYPE_LABELS,
  LOCATION_TYPES,
  REQUIRED_OFF_DUTY_MINUTES,
  ROLES,
  SHORT_HAUL_LABELS,
  SHORT_HAUL_RADIUS_MILES,
  SHORT_HAUL_STATUSES,
  SHORT_HAUL_WINDOW_MINUTES,
  TRIP_STATUS_CHIP,
  TRIP_STATUS_LABELS,
  TRIP_STATUSES,
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

  it('keeps CONTAINER_TYPES in lockstep with labels', () => {
    expectUnionKeysMatch(CONTAINER_TYPES, CONTAINER_TYPE_LABELS)
  })

  it('keeps EQUIPMENT_TYPES in lockstep with labels and lengths', () => {
    expectUnionKeysMatch(EQUIPMENT_TYPES, EQUIPMENT_TYPE_LABELS, EQUIPMENT_LENGTH_FT)
  })

  it('keeps TRIP_STATUSES in lockstep with labels and chips', () => {
    expectUnionKeysMatch(TRIP_STATUSES, TRIP_STATUS_LABELS, TRIP_STATUS_CHIP)
  })

  it('keeps EVENT_TYPES in lockstep with labels and glyphs', () => {
    expectUnionKeysMatch(EVENT_TYPES, EVENT_TYPE_LABELS, EVENT_GLYPH)
  })

  it('keeps LOCATION_TYPES in lockstep with labels and glyphs', () => {
    expectUnionKeysMatch(LOCATION_TYPES, LOCATION_TYPE_LABELS, LOCATION_GLYPH)
  })

  it('keeps SHORT_HAUL_STATUSES in lockstep with labels', () => {
    expectUnionKeysMatch(SHORT_HAUL_STATUSES, SHORT_HAUL_LABELS)
  })

  it('keeps DOCUMENT_CATEGORIES in lockstep with labels', () => {
    expectUnionKeysMatch(DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS)
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
