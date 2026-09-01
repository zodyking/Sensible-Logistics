import { describe, expect, it } from 'vitest'

import {
  formatPhoneDisplay,
  formatPhoneInput,
  isValidPhone,
  isBlankOrValidPhone,
  phoneDigits,
  phonesEqual,
  toE164,
} from '../shared/utils/phone'

describe('phoneDigits', () => {
  it('strips formatting characters', () => {
    expect(phoneDigits('(954) 555-0142')).toBe('9545550142')
    expect(phoneDigits('954.555.0142')).toBe('9545550142')
    expect(phoneDigits('954 555 0142')).toBe('9545550142')
  })

  it('drops the North American country code', () => {
    expect(phoneDigits('+1 (954) 555-0142')).toBe('9545550142')
    expect(phoneDigits('19545550142')).toBe('9545550142')
    expect(phoneDigits('+1-954-555-0142')).toBe('9545550142')
  })

  it('keeps a leading 1 that is part of a shorter number', () => {
    expect(phoneDigits('1954555')).toBe('1954555')
  })

  it('handles empty input', () => {
    expect(phoneDigits('')).toBe('')
    expect(phoneDigits(null)).toBe('')
    expect(phoneDigits(undefined)).toBe('')
  })
})

describe('formatPhoneInput', () => {
  it('formats progressively as digits are typed', () => {
    expect(formatPhoneInput('')).toBe('')
    expect(formatPhoneInput('9')).toBe('(9')
    expect(formatPhoneInput('954')).toBe('(954')
    expect(formatPhoneInput('9545')).toBe('(954) 5')
    expect(formatPhoneInput('954555')).toBe('(954) 555')
    expect(formatPhoneInput('9545550')).toBe('(954) 555-0')
    expect(formatPhoneInput('9545550142')).toBe('(954) 555-0142')
  })

  it('is idempotent, so re-masking on every keystroke is stable', () => {
    const once = formatPhoneInput('9545550142')
    expect(formatPhoneInput(once)).toBe(once)
  })

  it('ignores extra digits beyond ten', () => {
    expect(formatPhoneInput('95455501429999')).toBe('(954) 555-0142')
  })

  it('accepts a pasted country code', () => {
    expect(formatPhoneInput('+1 954 555 0142')).toBe('(954) 555-0142')
  })

  it('ignores stray letters', () => {
    expect(formatPhoneInput('954abc5550142')).toBe('(954) 555-0142')
  })
})

describe('isValidPhone', () => {
  it('requires ten digits', () => {
    expect(isValidPhone('(954) 555-0142')).toBe(true)
    expect(isValidPhone('+1 954 555 0142')).toBe(true)
    expect(isValidPhone('954555014')).toBe(false)
    expect(isValidPhone('')).toBe(false)
  })
})

describe('isBlankOrValidPhone', () => {
  it('allows a blank field and a complete number', () => {
    expect(isBlankOrValidPhone('')).toBe(true)
    expect(isBlankOrValidPhone('   ')).toBe(true)
    expect(isBlankOrValidPhone('(954) 555-0142')).toBe(true)
    expect(isBlankOrValidPhone('954555014')).toBe(false)
  })
})

describe('formatPhoneDisplay', () => {
  it('normalises stored values for display', () => {
    expect(formatPhoneDisplay('+19545550142')).toBe('(954) 555-0142')
    expect(formatPhoneDisplay('9545550142')).toBe('(954) 555-0142')
    expect(formatPhoneDisplay('+1-954-555-0142')).toBe('(954) 555-0142')
  })

  it('leaves non-conforming values untouched rather than mangling them', () => {
    expect(formatPhoneDisplay('+44 20 7946 0958')).toBe('+44 20 7946 0958')
    expect(formatPhoneDisplay('ext 4021')).toBe('ext 4021')
  })

  it('returns an empty string for blank input', () => {
    expect(formatPhoneDisplay(null)).toBe('')
    expect(formatPhoneDisplay('   ')).toBe('')
  })
})

describe('toE164', () => {
  it('canonicalises complete numbers', () => {
    expect(toE164('(954) 555-0142')).toBe('+19545550142')
    expect(toE164('954 555 0142')).toBe('+19545550142')
    expect(toE164('+1 954 555 0142')).toBe('+19545550142')
  })

  it('round-trips through the display formatter', () => {
    expect(formatPhoneDisplay(toE164('9545550142'))).toBe('(954) 555-0142')
  })

  it('preserves values it cannot canonicalise', () => {
    expect(toE164('+44 20 7946 0958')).toBe('+44 20 7946 0958')
  })
})

describe('phonesEqual', () => {
  it('treats formatted and E.164 forms as the same number', () => {
    expect(phonesEqual('(954) 555-0142', '+19545550142')).toBe(true)
    expect(phonesEqual('+1 954 555 0142', '9545550142')).toBe(true)
    expect(phonesEqual('+19545550142', '+19545550999')).toBe(false)
  })
})
