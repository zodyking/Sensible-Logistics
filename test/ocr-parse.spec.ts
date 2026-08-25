import { describe, expect, it } from 'vitest'
import { extractChassisTokens, extractIsoWindows, parseEquipmentReadings } from '../shared/utils/ocr-parse'

describe('extractIsoWindows', () => {
  it('finds a valid number in a noisy transcript', () => {
    expect(extractIsoWindows('MSCU 452189 4')).toEqual(['MSCU4521894'])
  })

  it('finds the number when OCR wraps vertical letters onto separate lines', () => {
    expect(extractIsoWindows('M\nS\nC\nU\n4\n5\n2\n1\n8\n9\n4')).toEqual(['MSCU4521894'])
  })

  it('ignores short fragments', () => {
    expect(extractIsoWindows('MSCU452')).toEqual([])
  })
})

describe('extractChassisTokens', () => {
  it('keeps a horizontal plate as one token', () => {
    expect(extractChassisTokens('ABCZ 1234567')).toContain('ABCZ1234567')
  })

  it('keeps a non-ISO fleet number', () => {
    expect(extractChassisTokens('TRLR 88421')).toContain('TRLR88421')
  })
})

describe('parseEquipmentReadings', () => {
  it('ranks a check-digit-valid container first', () => {
    const ranked = parseEquipmentReadings(['MSCU4521894 garbage CSQU3054383'], 'container')
    expect(ranked[0]?.value).toBe('MSCU4521894')
    expect(ranked[0]?.checkDigitValid).toBe(true)
  })

  it('offers ISO corrections when the engine reads O for 0', () => {
    const ranked = parseEquipmentReadings(['CSQU3O54383'], 'container')
    expect(ranked.some(c => c.value === 'CSQU3054383' && c.checkDigitValid)).toBe(true)
  })

  it('ignores 11-character garbage that is not an owner-code prefix', () => {
    const ranked = parseEquipmentReadings(['T000NLNTUWV'], 'container')
    expect(ranked.map(c => c.value)).not.toContain('T000NLNTUWV')
  })

  it('ignores English-word hallucinations like TEXT plus zeros', () => {
    const ranked = parseEquipmentReadings(['TEXT 110000-0', 'TEXT1100000'], 'container')
    expect(ranked.map(c => c.value)).not.toContain('TEXT1100000')
    expect(ranked.every(c => c.value[3] === 'U' || c.value[3] === 'J' || c.value[3] === 'Z')).toBe(true)
  })

  it('returns chassis tokens that are not ISO-shaped', () => {
    const ranked = parseEquipmentReadings(['TRLR88421'], 'chassis')
    expect(ranked.map(c => c.value)).toContain('TRLR88421')
  })
})
