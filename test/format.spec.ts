import { describe, expect, it } from 'vitest'

import { formatDurationBetween } from '../app/utils/format'

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
