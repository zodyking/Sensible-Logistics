import { describe, expect, it } from 'vitest'
import { missingLoadedSeal, normalizeSealNumber, sealForLoad } from '../shared/utils/seal'

describe('sealForLoad', () => {
  it('requires a trimmed seal on a loaded box', () => {
    expect(missingLoadedSeal(true, '')).toBe(true)
    expect(missingLoadedSeal(true, '  ')).toBe(true)
    expect(missingLoadedSeal(true, 'SL-100')).toBe(false)
    expect(sealForLoad(true, '  SL-100  ')).toBe('SL-100')
  })

  it('clears the seal when the box is empty', () => {
    expect(missingLoadedSeal(false, 'SL-100')).toBe(false)
    expect(sealForLoad(false, 'SL-100')).toBe(null)
    expect(normalizeSealNumber('  ')).toBe(null)
  })
})
