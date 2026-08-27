import { describe, expect, it } from 'vitest'

import {
  toLocalIsoDate,
  tripActivityDays,
  tripOccursOnDay,
  tripPickupDay,
} from '../shared/utils/trip-days'

describe('toLocalIsoDate', () => {
  it('formats a local calendar day', () => {
    expect(toLocalIsoDate(new Date(2026, 7, 25, 11, 38))).toBe('2026-08-25')
  })

  it('returns null for missing values', () => {
    expect(toLocalIsoDate(null)).toBeNull()
    expect(toLocalIsoDate('not-a-date')).toBeNull()
  })
})

describe('tripActivityDays', () => {
  it('uses the pickup day when pickup and drop-off share a date', () => {
    const trip = {
      createdAt: new Date(2026, 7, 25, 11, 30),
      pickedUpAt: new Date(2026, 7, 25, 11, 38),
      droppedOffAt: new Date(2026, 7, 25, 14, 40),
    }

    expect(tripPickupDay(trip)).toBe('2026-08-25')
    expect(tripActivityDays(trip)).toEqual(['2026-08-25'])
    expect(tripOccursOnDay(trip, '2026-08-25')).toBe(true)
    expect(tripOccursOnDay(trip, '2026-08-24')).toBe(false)
  })

  it('marks both days when drop-off lands on the next calendar day', () => {
    const trip = {
      createdAt: new Date(2026, 7, 25, 22, 0),
      pickedUpAt: new Date(2026, 7, 25, 22, 10),
      droppedOffAt: new Date(2026, 7, 26, 1, 5),
    }

    expect(tripActivityDays(trip).sort()).toEqual(['2026-08-25', '2026-08-26'])
    expect(tripOccursOnDay(trip, '2026-08-25')).toBe(true)
    expect(tripOccursOnDay(trip, '2026-08-26')).toBe(true)
  })

  it('falls back to createdAt when the trip has not been picked up', () => {
    const trip = {
      createdAt: new Date(2026, 7, 27, 8, 0),
      pickedUpAt: null,
      droppedOffAt: null,
    }

    expect(tripPickupDay(trip)).toBe('2026-08-27')
    expect(tripActivityDays(trip)).toEqual(['2026-08-27'])
  })
})
