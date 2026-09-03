import { describe, expect, it } from 'vitest'

import {
  countDayWork,
  formatDayWorkSummary,
  sortTripsForDay,
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

describe('countDayWork', () => {
  it('counts pickups and drop-offs on their local days', () => {
    const trips = [
      { id: 'a', pickedUpAt: new Date(2026, 7, 27, 8, 0), droppedOffAt: new Date(2026, 7, 27, 10, 0) },
      { id: 'b', pickedUpAt: new Date(2026, 7, 27, 11, 0), droppedOffAt: new Date(2026, 7, 28, 1, 0) },
    ]
    expect(countDayWork(trips, '2026-08-27')).toEqual({ swaps: 0, pickups: 2, dropoffs: 1 })
    expect(countDayWork(trips, '2026-08-28')).toEqual({ swaps: 0, pickups: 0, dropoffs: 1 })
  })

  it('counts a swap pair once even when both legs fall on the same day', () => {
    const trips = [
      { id: 'empty', pickedUpAt: new Date(2026, 7, 27, 9, 0), droppedOffAt: new Date(2026, 7, 27, 10, 0), swapPairTripId: 'load' },
      { id: 'load', pickedUpAt: new Date(2026, 7, 27, 10, 5), droppedOffAt: new Date(2026, 7, 27, 11, 0), swapPairTripId: 'empty' },
    ]
    expect(countDayWork(trips, '2026-08-27')).toEqual({ swaps: 1, pickups: 2, dropoffs: 2 })
  })
})

describe('sortTripsForDay', () => {
  it('orders a day top-down from earliest to latest', () => {
    const late = {
      id: 'late',
      createdAt: new Date(2026, 8, 2, 17, 59),
      pickedUpAt: new Date(2026, 8, 2, 16, 0),
      droppedOffAt: new Date(2026, 8, 2, 17, 59),
    }
    const morning = {
      id: 'morning',
      createdAt: new Date(2026, 8, 2, 4, 20),
      pickedUpAt: new Date(2026, 8, 2, 4, 20),
      droppedOffAt: new Date(2026, 8, 2, 4, 31),
    }
    const midday = {
      id: 'midday',
      createdAt: new Date(2026, 8, 2, 9, 29),
      pickedUpAt: new Date(2026, 8, 2, 9, 29),
      droppedOffAt: new Date(2026, 8, 2, 13, 2),
    }
    expect(sortTripsForDay([late, midday, morning], '2026-09-02').map(trip => trip.id))
      .toEqual(['morning', 'midday', 'late'])
  })
})

describe('formatDayWorkSummary', () => {
  it('omits zero counts and pluralizes', () => {
    expect(formatDayWorkSummary({ swaps: 0, pickups: 0, dropoffs: 0 })).toBe('')
    expect(formatDayWorkSummary({ swaps: 1, pickups: 2, dropoffs: 1 })).toBe('1 swap · 2 pickups · 1 drop-off')
    expect(formatDayWorkSummary({ swaps: 2, pickups: 0, dropoffs: 3 })).toBe('2 swaps · 3 drop-offs')
  })
})
