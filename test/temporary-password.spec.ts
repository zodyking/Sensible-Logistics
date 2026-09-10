import { describe, expect, it } from 'vitest'

import { generateTemporaryPassword } from '../server/utils/passwords'

describe('temporary driver passwords', () => {
  it('issues grouped 12-character passwords', () => {
    const password = generateTemporaryPassword()
    expect(password).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/)
    expect(password).not.toMatch(/[IlO01]/)
  })

  it('does not repeat the same value', () => {
    const seen = new Set(Array.from({ length: 20 }, () => generateTemporaryPassword()))
    expect(seen.size).toBe(20)
  })
})
