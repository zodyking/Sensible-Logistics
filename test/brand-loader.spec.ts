import { describe, expect, it } from 'vitest'
import { BRAND_LOADER_MIN_MS, brandLoaderRemainMs } from '../app/composables/useBrandLoader'

describe('brand loader hold', () => {
  it('holds the mark for at least five seconds', () => {
    expect(BRAND_LOADER_MIN_MS).toBe(5000)
    expect(brandLoaderRemainMs(1000, 1300)).toBe(4700)
  })

  it('keeps the mark up when the save was fast', () => {
    expect(brandLoaderRemainMs(1000, 1300, 1100)).toBe(800)
  })

  it('does not add extra hold when the save already took long enough', () => {
    expect(brandLoaderRemainMs(1000, 6500)).toBeLessThanOrEqual(0)
  })
})
