import { describe, expect, it } from 'vitest'
import {
  locationNoteAuthorName,
  locationNoteExpiresAt,
  locationNoteIsLive,
  locationNoteReviewIndex,
} from '../shared/utils/location-notes'

describe('locationNoteExpiresAt', () => {
  it('adds one calendar month', () => {
    expect(locationNoteExpiresAt(new Date('2026-01-15T12:00:00.000Z')).toISOString())
      .toBe('2026-02-15T12:00:00.000Z')
  })
})

describe('locationNoteIsLive', () => {
  it('is true before expiry and false after', () => {
    const expires = new Date('2026-03-01T00:00:00.000Z')
    expect(locationNoteIsLive(expires, new Date('2026-02-28T23:59:59.000Z'))).toBe(true)
    expect(locationNoteIsLive(expires, new Date('2026-03-01T00:00:00.000Z'))).toBe(false)
  })
})

describe('locationNoteReviewIndex', () => {
  it('steps through the deck and stops at the ends', () => {
    expect(locationNoteReviewIndex(0, 3, 1)).toBe(1)
    expect(locationNoteReviewIndex(2, 3, 1)).toBe(2)
    expect(locationNoteReviewIndex(0, 3, -1)).toBe(0)
    expect(locationNoteReviewIndex(0, 0, 1)).toBe(0)
  })
})

describe('locationNoteAuthorName', () => {
  it('prefers the full name, then first and last', () => {
    expect(locationNoteAuthorName({ fullName: 'Alex Rivera' })).toBe('Alex Rivera')
    expect(locationNoteAuthorName({ firstName: 'Jordan', lastName: 'Lee' })).toBe('Jordan Lee')
    expect(locationNoteAuthorName({})).toBe('Someone')
  })
})
