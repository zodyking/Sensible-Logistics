import { describe, expect, it } from 'vitest'
import { rolePageClass } from '../shared/utils/page-shell'

describe('rolePageClass', () => {
  it('uses the driver page shell for drivers', () => {
    expect(rolePageClass('DRIVER')).toBe('d-page')
    expect(rolePageClass(undefined)).toBe('d-page')
  })

  it('uses the admin wizard shell for dispatchers', () => {
    expect(rolePageClass('ADMIN')).toBe('a-wizard')
  })
})
