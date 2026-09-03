import { describe, expect, it } from 'vitest'
import { PRODUCT_NAME, resolveProductName } from '../shared/utils/brand'

describe('resolveProductName', () => {
  it('defaults to Yard Manager', () => {
    expect(resolveProductName(undefined)).toBe(PRODUCT_NAME)
    expect(resolveProductName('')).toBe(PRODUCT_NAME)
    expect(resolveProductName('   ')).toBe(PRODUCT_NAME)
  })

  it('replaces retired product and company titles', () => {
    expect(resolveProductName('Gantry')).toBe(PRODUCT_NAME)
    expect(resolveProductName('Sensible Logistics Solutions LLC')).toBe(PRODUCT_NAME)
    expect(resolveProductName('Sensible Logistics Solutions, LLC')).toBe(PRODUCT_NAME)
    expect(resolveProductName('sensible logistics')).toBe(PRODUCT_NAME)
    expect(resolveProductName('Container Tracker')).toBe(PRODUCT_NAME)
  })

  it('keeps a custom name that is not a retired title', () => {
    expect(resolveProductName('Harbor Yard')).toBe('Harbor Yard')
  })
})
