import { describe, expect, it } from 'vitest'

import type { EventType, LocationType } from '../shared/utils/domain'
import {
  SERVICE_RECORD_EVENT_TYPES,
  SERVICE_RECORD_LABELS,
  containerStatusAfterDropoff,
  describeDropoffEffect,
  dropoffCompletesServiceLife,
  isCustomerLoadingSite,
  isServiceRecordEvent,
  isServiceTerminus,
  sliceCurrentServiceLife,
  summarizeServiceLife,
} from '../shared/utils/service-life'

function event(
  eventType: EventType,
  occurredAt: string,
  locationType: LocationType | null,
  tripId = 'trip-a',
) {
  return { eventType, occurredAt, locationType, tripId }
}

describe('service-life location rules', () => {
  it('treats only marine and rail terminals as cycle start/end points', () => {
    expect(isServiceTerminus('MARINE_TERMINAL')).toBe(true)
    expect(isServiceTerminus('RAIL_TERMINAL')).toBe(true)
    expect(isServiceTerminus('COMPANY_YARD')).toBe(false)
    expect(isServiceTerminus('CUSTOMER')).toBe(false)
  })

  it('sets Loading only at customer and warehouse drop-offs', () => {
    expect(isCustomerLoadingSite('CUSTOMER')).toBe(true)
    expect(isCustomerLoadingSite('COMPANY_YARD')).toBe(false)
    expect(containerStatusAfterDropoff('CUSTOMER')).toBe('LOADING')
    expect(containerStatusAfterDropoff('COMPANY_YARD')).toBe('AT_YARD')
    expect(containerStatusAfterDropoff('MARINE_TERMINAL')).toBe('RETURNED')
    expect(containerStatusAfterDropoff('RAIL_TERMINAL')).toBe('RETURNED')
  })

  it('completes a service life only on a marine or rail drop-off', () => {
    expect(dropoffCompletesServiceLife('MARINE_TERMINAL')).toBe(true)
    expect(dropoffCompletesServiceLife('RAIL_TERMINAL')).toBe(true)
    expect(dropoffCompletesServiceLife('COMPANY_YARD')).toBe(false)
    expect(dropoffCompletesServiceLife('CUSTOMER')).toBe(false)
    expect(describeDropoffEffect('COMPANY_YARD')).toMatch(/intermediate/i)
    expect(describeDropoffEffect('CUSTOMER')).toMatch(/Loading/)
    expect(describeDropoffEffect('MARINE_TERMINAL')).toMatch(/completes/)
  })

  it('keeps only pickup and drop-off event types on the record', () => {
    expect(isServiceRecordEvent('PICKUP_CONFIRMED')).toBe(true)
    expect(isServiceRecordEvent('DROPOFF_CONFIRMED')).toBe(true)
    expect(isServiceRecordEvent('PICKUP_CANCELLED')).toBe(true)
    expect(isServiceRecordEvent('ACTIVATED')).toBe(false)
    expect(isServiceRecordEvent('LOADED')).toBe(false)
    expect(isServiceRecordEvent('CHASSIS_ATTACH')).toBe(false)
    expect(isServiceRecordEvent('STATUS_CHANGE')).toBe(false)
    expect(isServiceRecordEvent('RELEASED')).toBe(false)
    expect(Object.keys(SERVICE_RECORD_LABELS).sort()).toEqual([...SERVICE_RECORD_EVENT_TYPES].sort())
  })
})

describe('sliceCurrentServiceLife', () => {
  it('drops status-style events and hides pickup-started once confirmed', () => {
    const sliced = sliceCurrentServiceLife([
      event('DROPOFF_CONFIRMED', '2026-08-27T18:00:00Z', 'COMPANY_YARD'),
      event('ARRIVED', '2026-08-27T17:55:00Z', 'COMPANY_YARD'),
      event('PICKUP_CONFIRMED', '2026-08-27T16:00:00Z', 'MARINE_TERMINAL'),
      event('CHASSIS_ATTACH', '2026-08-27T16:00:00Z', 'MARINE_TERMINAL'),
      event('LOADED', '2026-08-27T16:00:00Z', 'MARINE_TERMINAL'),
      event('PICKUP_STARTED', '2026-08-27T15:50:00Z', 'MARINE_TERMINAL'),
      event('ACTIVATED', '2026-08-27T15:50:00Z', 'MARINE_TERMINAL'),
    ])

    expect(sliced.map(item => item.eventType)).toEqual([
      'DROPOFF_CONFIRMED',
      'PICKUP_CONFIRMED',
    ])
  })

  it('keeps a cancelled pickup on the open service life', () => {
    const sliced = sliceCurrentServiceLife([
      event('PICKUP_CANCELLED', '2026-08-27T19:11:00Z', 'COMPANY_YARD', 'trip-b'),
      event('PICKUP_STARTED', '2026-08-27T19:11:00Z', 'COMPANY_YARD', 'trip-b'),
      event('DROPOFF_CONFIRMED', '2026-08-27T18:00:00Z', 'COMPANY_YARD', 'trip-a'),
      event('PICKUP_CONFIRMED', '2026-08-27T16:00:00Z', 'MARINE_TERMINAL', 'trip-a'),
    ])

    expect(sliced.map(item => item.eventType)).toEqual([
      'PICKUP_CANCELLED',
      'PICKUP_STARTED',
      'DROPOFF_CONFIRMED',
      'PICKUP_CONFIRMED',
    ])
  })

  it('does not close the life on a company-yard or customer stop', () => {
    const sliced = sliceCurrentServiceLife([
      event('DROPOFF_CONFIRMED', '2026-08-28T12:00:00Z', 'CUSTOMER', 'trip-b'),
      event('PICKUP_CONFIRMED', '2026-08-28T10:00:00Z', 'COMPANY_YARD', 'trip-b'),
      event('DROPOFF_CONFIRMED', '2026-08-27T18:00:00Z', 'COMPANY_YARD', 'trip-a'),
      event('PICKUP_CONFIRMED', '2026-08-27T16:00:00Z', 'MARINE_TERMINAL', 'trip-a'),
    ])

    expect(sliced).toHaveLength(4)
    expect(sliced[0]?.locationType).toBe('CUSTOMER')
    expect(summarizeServiceLife(sliced).status).toBe('OPEN')
  })

  it('closes the current life on a marine or rail drop-off', () => {
    const sliced = sliceCurrentServiceLife([
      event('DROPOFF_CONFIRMED', '2026-08-29T15:00:00Z', 'RAIL_TERMINAL', 'trip-c'),
      event('PICKUP_CONFIRMED', '2026-08-29T12:00:00Z', 'CUSTOMER', 'trip-c'),
      event('DROPOFF_CONFIRMED', '2026-08-28T12:00:00Z', 'CUSTOMER', 'trip-b'),
      event('PICKUP_CONFIRMED', '2026-08-27T16:00:00Z', 'MARINE_TERMINAL', 'trip-a'),
    ])

    expect(sliced[0]?.locationType).toBe('RAIL_TERMINAL')
    expect(summarizeServiceLife(sliced).status).toBe('COMPLETE')
    expect(sliced).toHaveLength(4)
  })

  it('starts a new record after a completed return to terminal', () => {
    const sliced = sliceCurrentServiceLife([
      event('PICKUP_CONFIRMED', '2026-08-30T09:00:00Z', 'MARINE_TERMINAL', 'trip-new'),
      event('DROPOFF_CONFIRMED', '2026-08-29T15:00:00Z', 'MARINE_TERMINAL', 'trip-old'),
      event('PICKUP_CONFIRMED', '2026-08-27T16:00:00Z', 'MARINE_TERMINAL', 'trip-old'),
      event('STATUS_CHANGE', '2026-08-27T16:05:00Z', 'MARINE_TERMINAL', 'trip-old'),
    ])

    expect(sliced.map(item => item.tripId)).toEqual(['trip-new'])
    expect(sliced[0]?.eventType).toBe('PICKUP_CONFIRMED')
    expect(summarizeServiceLife(sliced).status).toBe('OPEN')
  })

  it('keeps the completed life visible until the next pickup starts', () => {
    const sliced = sliceCurrentServiceLife([
      event('DROPOFF_CONFIRMED', '2026-08-29T15:00:00Z', 'MARINE_TERMINAL', 'trip-b'),
      event('PICKUP_CONFIRMED', '2026-08-29T10:00:00Z', 'CUSTOMER', 'trip-b'),
      event('DROPOFF_CONFIRMED', '2026-08-28T12:00:00Z', 'CUSTOMER', 'trip-a'),
      event('PICKUP_CONFIRMED', '2026-08-27T16:00:00Z', 'MARINE_TERMINAL', 'trip-a'),
    ])

    expect(summarizeServiceLife(sliced).status).toBe('COMPLETE')
    expect(sliced).toHaveLength(4)
    expect(sliced[0]?.eventType).toBe('DROPOFF_CONFIRMED')
    expect(sliced.at(-1)?.eventType).toBe('PICKUP_CONFIRMED')
  })
})
