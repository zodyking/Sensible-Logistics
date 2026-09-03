import { describe, expect, it } from 'vitest'
import { brandLoaderRemainMs } from '../app/composables/useBrandLoader'

describe('brand loader hold', () => {
  it('keeps the mark up when the save was fast', () => {
    expect(brandLoaderRemainMs(1000, 1300)).toBe(800)
  })

  it('does not add extra hold when the save already took long enough', () => {
    expect(brandLoaderRemainMs(1000, 2500)).toBeLessThanOrEqual(0)
  })
})
