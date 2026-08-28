import { describe, expect, it } from 'vitest'
import { RESET_TARGET_IDS, RESET_TARGETS } from '../shared/utils/reset-targets'

describe('RESET_TARGETS', () => {
  it('covers every target id once, including users', () => {
    expect(RESET_TARGETS.map(row => row.id)).toEqual([...RESET_TARGET_IDS])
    expect(new Set(RESET_TARGETS.map(row => row.id)).size).toBe(RESET_TARGET_IDS.length)
    const users = RESET_TARGETS.find(row => row.id === 'users')
    expect(users?.hint.toLowerCase()).toContain('yours stays')
  })
})
