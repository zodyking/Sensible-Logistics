import { describe, expect, it } from 'vitest'

import {
  computeCheckDigit,
  formatContainerNumber,
  generateCorrectionCandidates,
  isValidContainerNumber,
  normalizeContainerNumber,
  validateContainerNumber,
} from '../shared/utils/iso6346'

/**
 * Independent ISO 6346 check-digit calculator. Letter values are the published
 * table (A=10, skip every multiple of 11). Remainder 10 is expressed as 0.
 */
const REF_LETTER_VALUES: Record<string, number> = {
  A: 10,
  B: 12,
  C: 13,
  D: 14,
  E: 15,
  F: 16,
  G: 17,
  H: 18,
  I: 19,
  J: 20,
  K: 21,
  L: 23,
  M: 24,
  N: 25,
  O: 26,
  P: 27,
  Q: 28,
  R: 29,
  S: 30,
  T: 31,
  U: 32,
  V: 34,
  W: 35,
  X: 36,
  Y: 37,
  Z: 38,
}

function referenceCheckDigit(prefix: string): number | null {
  const value = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)
  if (!/^[A-Z]{4}\d{6}$/.test(value)) return null

  let sum = 0
  for (let i = 0; i < 10; i++) {
    const char = value[i]
    if (char === undefined) return null
    const numeric = i < 4 ? REF_LETTER_VALUES[char] : Number.parseInt(char, 10)
    if (numeric === undefined || Number.isNaN(numeric)) return null
    sum += numeric * (2 ** i)
  }

  const remainder = sum % 11
  return remainder === 10 ? 0 : remainder
}

function generatePrefixes(count: number): string[] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return Array.from({ length: count }, (_, i) => {
    const owner = [
      alphabet[i % 26],
      alphabet[(i * 5 + 3) % 26],
      alphabet[(i * 11 + 7) % 26],
      alphabet[(i * 13 + 20) % 26],
    ].join('')
    return `${owner}${String(i).padStart(6, '0')}`
  })
}

function expectCandidateInvariants(input: string, candidates: string[]) {
  const normalized = normalizeContainerNumber(input)
  expect(candidates.length).toBeLessThanOrEqual(5)
  expect(candidates).not.toContain(normalized)
  for (const candidate of candidates) {
    expect(isValidContainerNumber(candidate)).toBe(true)
    for (const [index, char] of [...candidate].entries()) {
      if (index < 4) {
        expect(char).toMatch(/[A-Z]/)
      }
      else {
        expect(char).toMatch(/\d/)
      }
    }
  }
}

describe('normalizeContainerNumber', () => {
  it('uppercases lowercase input', () => {
    expect(normalizeContainerNumber('csqu3054383')).toBe('CSQU3054383')
  })

  it('strips embedded spaces', () => {
    expect(normalizeContainerNumber('CSQU 305438 3')).toBe('CSQU3054383')
  })

  it('strips hyphens', () => {
    expect(normalizeContainerNumber('CSQU-305438-3')).toBe('CSQU3054383')
  })

  it('strips dots', () => {
    expect(normalizeContainerNumber('CSQU.305438.3')).toBe('CSQU3054383')
  })

  it('strips mixed junk', () => {
    expect(normalizeContainerNumber('mscu 452189-7')).toBe('MSCU4521897')
  })

  it('returns an empty string for empty input', () => {
    expect(normalizeContainerNumber('')).toBe('')
  })

  it('returns an empty string for punctuation-only input', () => {
    expect(normalizeContainerNumber('---...///')).toBe('')
  })
})

describe('computeCheckDigit', () => {
  it('returns 3 for the canonical ISO 6346 example CSQU305438', () => {
    // C=13*1=13, S=30*2=60, Q=28*4=112, U=32*8=256
    // 3*16=48, 0*32=0, 5*64=320, 4*128=512, 3*256=768, 8*512=4096
    // sum=6185, 6185 % 11 = 3
    expect(computeCheckDigit('CSQU305438')).toBe(3)
    expect(referenceCheckDigit('CSQU305438')).toBe(3)
  })

  it('returns 4 for MSCU452189', () => {
    // M=24*1=24, S=30*2=60, C=13*4=52, U=32*8=256
    // 4*16=64, 5*32=160, 2*64=128, 1*128=128, 8*256=2048, 9*512=4608
    // sum=7528, 7528 % 11 = 4
    expect(computeCheckDigit('MSCU452189')).toBe(4)
    expect(referenceCheckDigit('MSCU452189')).toBe(4)
  })

  it('returns 8 for TCLU123456', () => {
    // T=31*1=31, C=13*2=26, L=23*4=92, U=32*8=256
    // 1*16=16, 2*32=64, 3*64=192, 4*128=512, 5*256=1280, 6*512=3072
    // sum=5541, 5541 % 11 = 8
    expect(computeCheckDigit('TCLU123456')).toBe(8)
    expect(referenceCheckDigit('TCLU123456')).toBe(8)
  })

  it('maps a remainder of 10 to check digit 0', () => {
    // CSQU000007: C=13*1=13, S=30*2=60, Q=28*4=112, U=32*8=256
    // 0*16=0, 0*32=0, 0*64=0, 0*128=0, 0*256=0, 7*512=3584
    // sum=4025, 4025 % 11 = 10 → 0
    expect(referenceCheckDigit('CSQU000007')).toBe(0)
    expect(computeCheckDigit('CSQU000007')).toBe(0)
  })

  it('matches the independent reference implementation across generated prefixes', () => {
    const prefixes = generatePrefixes(50)
    expect(prefixes).toHaveLength(50)
    for (const prefix of prefixes) {
      expect(computeCheckDigit(prefix)).toBe(referenceCheckDigit(prefix))
    }
  })

  it('returns null for a prefix that is too short', () => {
    expect(computeCheckDigit('CSQU30543')).toBeNull()
  })

  it('returns null when letter positions contain digits', () => {
    expect(computeCheckDigit('1SQU305438')).toBeNull()
  })

  it('returns null when digit positions contain letters', () => {
    expect(computeCheckDigit('CSQU30543A')).toBeNull()
  })
})

describe('validateContainerNumber', () => {
  it('accepts a fully valid number and returns the parsed fields', () => {
    expect(validateContainerNumber('CSQU3054383')).toEqual({
      normalized: 'CSQU3054383',
      valid: true,
      structureValid: true,
      checkDigitValid: true,
      checkDigit: 3,
      expectedCheckDigit: 3,
      ownerCode: 'CSQ',
      equipmentCategory: 'U',
      serial: '305438',
      errors: [],
      warnings: [],
    })
  })

  it('rejects a wrong check digit while keeping structure valid', () => {
    const result = validateContainerNumber('CSQU3054389')
    expect(result.valid).toBe(false)
    expect(result.checkDigitValid).toBe(false)
    expect(result.structureValid).toBe(true)
    expect(result.ownerCode).toBe('CSQ')
    expect(result.equipmentCategory).toBe('U')
    expect(result.serial).toBe('305438')
    expect(result.checkDigit).toBe(9)
    expect(result.expectedCheckDigit).toBe(3)
    expect(result.errors).toContain('Check digit failed: expected 3, received 9.')
  })

  it('rejects a 10-character value as the wrong length', () => {
    const result = validateContainerNumber('CSQU305438')
    expect(result.valid).toBe(false)
    expect(result.structureValid).toBe(false)
    expect(result.errors).toContain('Container numbers are 11 characters; received 10.')
  })

  it('rejects a 12-character value as the wrong length', () => {
    const result = validateContainerNumber('CSQU30543831')
    expect(result.valid).toBe(false)
    expect(result.structureValid).toBe(false)
    expect(result.errors).toContain('Container numbers are 11 characters; received 12.')
  })

  it('rejects the right length with digits in the owner-code positions', () => {
    const result = validateContainerNumber('1SCU4521894')
    expect(result.valid).toBe(false)
    expect(result.structureValid).toBe(false)
    expect(result.checkDigitValid).toBe(false)
    expect(result.errors).toContain(
      'Expected four letters followed by seven digits (e.g. MSCU4521894).',
    )
  })

  it('rejects empty input with a required error', () => {
    const result = validateContainerNumber('')
    expect(result.valid).toBe(false)
    expect(result.structureValid).toBe(false)
    expect(result.errors).toContain('Container number is required.')
  })

  it('accepts a valid Z-category number with a trailer/chassis warning', () => {
    // C=13*1=13, S=30*2=60, Q=28*4=112, Z=38*8=304
    // 3*16=48, 0*32=0, 5*64=320, 4*128=512, 3*256=768, 8*512=4096
    // sum=6233, 6233 % 11 = 7
    const result = validateContainerNumber('CSQZ3054387')
    expect(result.valid).toBe(true)
    expect(result.structureValid).toBe(true)
    expect(result.checkDigitValid).toBe(true)
    expect(result.equipmentCategory).toBe('Z')
    expect(result.errors).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings).toContain(
      'Category Z identifies a trailer or chassis, not a freight container.',
    )
  })

  it('accepts a valid J-category number with a detachable-equipment warning', () => {
    // C=13*1=13, S=30*2=60, Q=28*4=112, J=20*8=160
    // 3*16=48, 0*32=0, 5*64=320, 4*128=512, 3*256=768, 8*512=4096
    // sum=6089, 6089 % 11 = 6
    const result = validateContainerNumber('CSQJ3054386')
    expect(result.valid).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings).toContain(
      'Category J identifies detachable container equipment, not a freight container.',
    )
  })

  it('warns when the 4th character is outside U/J/Z but still evaluates the check digit', () => {
    // C=13*1=13, S=30*2=60, Q=28*4=112, A=10*8=80
    // 3*16=48, 0*32=0, 5*64=320, 4*128=512, 3*256=768, 8*512=4096
    // sum=6009, 6009 % 11 = 3
    const result = validateContainerNumber('CSQA3054383')
    expect(result.structureValid).toBe(true)
    expect(result.checkDigitValid).toBe(true)
    expect(result.expectedCheckDigit).toBe(3)
    expect(result.checkDigit).toBe(3)
    expect(result.equipmentCategory).toBe('A')
    expect(result.warnings).toContain(
      'Equipment category "A" is outside ISO 6346 (expected U, J or Z).',
    )
  })
})

describe('isValidContainerNumber', () => {
  it('returns true for a valid number', () => {
    expect(isValidContainerNumber('CSQU3054383')).toBe(true)
  })

  it('returns false for a wrong check digit', () => {
    expect(isValidContainerNumber('CSQU3054389')).toBe(false)
  })

  it('returns false for empty and short input', () => {
    expect(isValidContainerNumber('')).toBe(false)
    expect(isValidContainerNumber('CSQU305438')).toBe(false)
  })
})

describe('formatContainerNumber', () => {
  it('groups a valid number as AAAA NNNNNN-C', () => {
    expect(formatContainerNumber('CSQU3054383')).toBe('CSQU 305438-3')
    expect(formatContainerNumber('mscu4521894')).toBe('MSCU 452189-4')
  })

  it('returns the normalized string unchanged for invalid or short input', () => {
    expect(formatContainerNumber('CSQU305438')).toBe('CSQU305438')
    expect(formatContainerNumber('ms-cu')).toBe('MSCU')
    expect(formatContainerNumber('---')).toBe('')
  })
})

describe('generateCorrectionCandidates', () => {
  const original = 'CSQU3054383'

  it('recovers the original when a serial 0 is corrupted to O', () => {
    const corrupted = 'CSQU3O54383'
    const candidates = generateCorrectionCandidates(corrupted)
    expect(candidates).toContain(original)
    expect(candidates).not.toContain(corrupted)
    expectCandidateInvariants(corrupted, candidates)
  })

  it('recovers the original when an owner-code S is corrupted to 5', () => {
    const corrupted = 'C5QU3054383'
    const candidates = generateCorrectionCandidates(corrupted)
    expect(candidates).toContain(original)
    expect(candidates).not.toContain(corrupted)
    expectCandidateInvariants(corrupted, candidates)
  })

  it('never returns the input itself as a candidate', () => {
    const candidates = generateCorrectionCandidates(original)
    expect(candidates).not.toContain(original)
    expectCandidateInvariants(original, candidates)
  })

  it('returns only ISO-valid candidates', () => {
    const candidates = generateCorrectionCandidates('CSQU3O54383')
    for (const candidate of candidates) {
      expect(isValidContainerNumber(candidate)).toBe(true)
    }
  })

  it('returns an empty list when the input is the wrong length', () => {
    expect(generateCorrectionCandidates('CSQU305438')).toEqual([])
    expect(generateCorrectionCandidates('CSQU30543831')).toEqual([])
    expect(generateCorrectionCandidates('')).toEqual([])
  })

  it('never returns more than 5 candidates', () => {
    const samples = [original, 'CSQU3O54383', 'C5QU3054383', 'AAAAAAAAAAA']
    for (const sample of samples) {
      expect(generateCorrectionCandidates(sample).length).toBeLessThanOrEqual(5)
    }
  })

  it('does not recover the original when lowConfidence excludes the corrupted index', () => {
    const corrupted = 'CSQU3O54383'
    const recovered = generateCorrectionCandidates(corrupted, [5])
    expect(recovered).toContain(original)

    const missed = generateCorrectionCandidates(corrupted, [0])
    expect(missed).not.toContain(original)
  })

  it('never emits a digit in positions 0-3 or a letter in positions 4-10', () => {
    const candidates = generateCorrectionCandidates('CSQU3O54383')
    expect(candidates.length).toBeGreaterThan(0)
    expectCandidateInvariants('CSQU3O54383', candidates)
  })
})
