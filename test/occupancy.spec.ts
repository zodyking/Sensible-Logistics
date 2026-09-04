import { describe, expect, it } from 'vitest'
import type { EventType, LocationType } from '../shared/utils/domain'
import {
  calendarDaysOld,
  formatSlashDate,
  occupancyFromEvents,
  occupancyPickupAt,
} from '../shared/utils/occupancy'

function event(
  eventType: EventType,
  occurredAt: string,
  locationType: LocationType | null,
) {
  return { eventType, occurredAt, locationType, tripId: 'trip-a' }
}

describe('occupancy date helpers', () => {
  it('formats a compact slash date', () => {
    expect(formatSlashDate(new Date(2026, 8, 3))).toBe('09/03/26')
  })

  it('counts local calendar days', () => {
    expect(calendarDaysOld('2026-08-26T16:00:00Z', '2026-09-03T12:00:00Z')).toBeGreaterThanOrEqual(7)
    expect(calendarDaysOld('2026-09-03T08:00:00', '2026-09-03T22:00:00')).toBe(0)
  })
})

describe('occupancyPickupAt', () => {
  it('starts at the marine or rail pull and stays open at a yard', () => {
    const started = occupancyPickupAt([
      event('DROPOFF_CONFIRMED', '2026-08-28T18:00:00Z', 'COMPANY_YARD'),
      event('PICKUP_CONFIRMED', '2026-08-26T16:00:00Z', 'MARINE_TERMINAL'),
    ])
    expect(started).toBe('2026-08-26T16:00:00Z')
  })

  it('clears occupancy after a terminal return', () => {
    expect(occupancyPickupAt([
      event('DROPOFF_CONFIRMED', '2026-08-29T15:00:00Z', 'RAIL_TERMINAL'),
      event('PICKUP_CONFIRMED', '2026-08-26T16:00:00Z', 'MARINE_TERMINAL'),
    ])).toBeNull()
  })

  it('ignores a later yard pickup and keeps the terminal pull', () => {
    const started = occupancyPickupAt([
      event('PICKUP_CONFIRMED', '2026-08-28T10:00:00Z', 'COMPANY_YARD'),
      event('DROPOFF_CONFIRMED', '2026-08-27T18:00:00Z', 'COMPANY_YARD'),
      event('PICKUP_CONFIRMED', '2026-08-26T16:00:00Z', 'MARINE_TERMINAL'),
    ])
    expect(started).toBe('2026-08-26T16:00:00Z')
  })

  it('starts a new clock after the next terminal pull', () => {
    const started = occupancyPickupAt([
      event('PICKUP_CONFIRMED', '2026-08-30T09:00:00Z', 'RAIL_TERMINAL'),
      event('DROPOFF_CONFIRMED', '2026-08-29T15:00:00Z', 'MARINE_TERMINAL'),
      event('PICKUP_CONFIRMED', '2026-08-26T16:00:00Z', 'MARINE_TERMINAL'),
    ])
    expect(started).toBe('2026-08-30T09:00:00Z')
  })
})

describe('occupancyFromEvents', () => {
  it('builds the card copy', () => {
    const occupancy = occupancyFromEvents([
      event('PICKUP_CONFIRMED', '2026-09-01T16:00:00Z', 'MARINE_TERMINAL'),
    ], '2026-09-03T18:00:00Z')
    expect(occupancy?.daysLabel).toMatch(/days old$/)
    expect(occupancy?.pickedUpLabel).toMatch(/^picked up \d{2}\/\d{2}\/\d{2}$/)
  })
})
