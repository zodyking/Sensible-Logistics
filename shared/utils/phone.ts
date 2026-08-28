/**
 * North American phone number handling.
 *
 * Drivers type on a phone keypad in a yard, so input is masked as they go and
 * stored in a single canonical form. Display formatting is derived, never
 * persisted, so a number entered as `9545550142` and one pasted as
 * `+1 (954) 555-0142` become the same record.
 */

/** Digits only, with the North American `1` country code dropped. */
export function phoneDigits(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '')
  // A leading 1 on an 11-digit number is the country code, not an area code.
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  return digits
}

export function isValidPhone(value: string | null | undefined): boolean {
  return phoneDigits(value).length === 10
}

/**
 * Progressive mask for a text input. Partial input stays partially formatted so
 * the caret never jumps ahead of what has been typed.
 */
export function formatPhoneInput(value: string | null | undefined): string {
  const digits = phoneDigits(value).slice(0, 10)

  if (digits.length === 0) return ''
  if (digits.length <= 3) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/**
 * Display form. Anything that is not a complete 10-digit number is returned
 * unchanged rather than mangled — international numbers and legacy records
 * should stay readable.
 */
export function formatPhoneDisplay(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const digits = phoneDigits(raw)
  if (digits.length !== 10) return raw
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

/**
 * Canonical storage form, E.164. Falls back to the trimmed original when the
 * value is not a complete North American number so nothing is silently lost.
 */
export function toE164(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  const digits = phoneDigits(raw)
  if (digits.length !== 10) return raw
  return `+1${digits}`
}

/** True when both values canonicalise to the same North American number. */
export function phonesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = toE164(a)
  const right = toE164(b)
  return Boolean(left && right && left === right)
}
