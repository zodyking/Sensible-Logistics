import { describe, expect, it } from 'vitest'

import { formatDayOf, formatDurationBetween, formatWorkDate } from '../app/utils/format'

describe('formatDayOf', () => {
  it('labels the current work day as today', () => {
    expect(formatDayOf('2026-09-01', '2026-09-01')).toBe('Day of today · Tue, Sep 1')
  })

  it('labels other work days with weekday and date', () => {
    expect(formatDayOf('2026-08-31', '2026-09-01')).toBe('Day of Mon, Aug 31')
  })
})

describe('formatWorkDate', () => {
  it('keeps the calendar day in UTC so Eastern does not roll back a day', () => {
    expect(formatWorkDate('2026-09-02')).toBe('Wed, Sep 2')
    expect(formatWorkDate('2026-09-01')).toBe('Tue, Sep 1')
  })
})

describe('formatDurationBetween', () => {
  it('returns minutes under an hour', () => {
    expect(formatDurationBetween('2026-08-25T15:38:00.000Z', '2026-08-25T16:10:00.000Z')).toBe('32 min')
  })

  it('returns hours and leftover minutes', () => {
    expect(formatDurationBetween('2026-08-25T16:05:00.000Z', '2026-08-25T18:40:00.000Z')).toBe('2h 35m')
  })

  it('returns whole hours', () => {
    expect(formatDurationBetween('2026-08-25T12:00:00.000Z', '2026-08-25T15:00:00.000Z')).toBe('3h')
  })

  it('returns null when a stamp is missing', () => {
    expect(formatDurationBetween(null, '2026-08-25T16:10:00.000Z')).toBeNull()
  })
})
