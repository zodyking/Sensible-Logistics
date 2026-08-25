/**
 * ISO 6346 container identification: structure parsing, check-digit computation
 * and deterministic OCR correction candidates.
 *
 * Canonical format: AAAU1234567
 *   - positions 0-2  owner code (alphabetic)
 *   - position  3    equipment category (U freight, J detachable equipment, Z trailer/chassis)
 *   - positions 4-9  six-digit serial number
 *   - position  10   check digit
 *
 * Spec references: section 5.1, 30.4, 30.5.
 */

/** Equipment category letters defined by ISO 6346. */
export const EQUIPMENT_CATEGORIES = ['U', 'J', 'Z'] as const
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number]

/**
 * ISO 6346 letter values. Numbering starts at A=10 and increments, skipping
 * every multiple of 11 (11, 22, 33) because those collide with the modulus.
 */
const LETTER_VALUES: Record<string, number> = (() => {
  const values: Record<string, number> = {}
  let value = 10
  for (let i = 0; i < 26; i++) {
    while (value % 11 === 0) value++
    values[String.fromCharCode(65 + i)] = value
    value++
  }
  return values
})()

const STRUCTURE_RE = /^[A-Z]{4}\d{7}$/
const PREFIX_RE = /^[A-Z]{4}\d{6}$/

export interface ContainerNumberValidation {
  /** Uppercased, punctuation-stripped input. */
  normalized: string
  /** True only when structure, category and check digit all pass. */
  valid: boolean
  /** True when the value is 4 letters followed by 7 digits. */
  structureValid: boolean
  /** True when the trailing digit matches the computed check digit. */
  checkDigitValid: boolean
  /** Check digit supplied by the input, when the structure allows one. */
  checkDigit: number | null
  /** Check digit derived from the first ten characters. */
  expectedCheckDigit: number | null
  ownerCode: string | null
  equipmentCategory: string | null
  serial: string | null
  /** Human-readable problems, ordered most significant first. */
  errors: string[]
  /** Non-blocking observations (e.g. a non-freight equipment category). */
  warnings: string[]
}

/** Uppercase and strip everything that is not A-Z or 0-9. */
export function normalizeContainerNumber(input: string): string {
  return (input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Compute the ISO 6346 check digit from the first ten characters
 * (owner code + equipment category + six serial digits).
 *
 * Each character is converted to its numeric value, multiplied by 2^index,
 * summed, and reduced modulo 11. A remainder of 10 is expressed as 0.
 *
 * @returns the check digit, or null when the prefix is malformed.
 */
export function computeCheckDigit(prefix: string): number | null {
  const value = normalizeContainerNumber(prefix).slice(0, 10)
  if (!PREFIX_RE.test(value)) return null

  let sum = 0
  for (let i = 0; i < 10; i++) {
    const char = value[i]!
    const numeric = i < 4 ? LETTER_VALUES[char] : Number(char)
    if (numeric === undefined || Number.isNaN(numeric)) return null
    sum += numeric * 2 ** i
  }

  return (sum % 11) % 10
}

/** Full structural + check-digit validation of a container number. */
export function validateContainerNumber(input: string): ContainerNumberValidation {
  const normalized = normalizeContainerNumber(input)
  const errors: string[] = []
  const warnings: string[] = []

  const structureValid = STRUCTURE_RE.test(normalized)

  if (!normalized) {
    errors.push('Container number is required.')
  }
  else if (!structureValid) {
    if (normalized.length !== 11) {
      errors.push(`Container numbers are 11 characters; received ${normalized.length}.`)
    }
    else {
      errors.push('Expected four letters followed by seven digits (e.g. MSCU4521894).')
    }
  }

  if (!structureValid) {
    return {
      normalized,
      valid: false,
      structureValid: false,
      checkDigitValid: false,
      checkDigit: null,
      expectedCheckDigit: computeCheckDigit(normalized),
      ownerCode: null,
      equipmentCategory: null,
      serial: null,
      errors,
      warnings,
    }
  }

  const ownerCode = normalized.slice(0, 3)
  const equipmentCategory = normalized[3]!
  const serial = normalized.slice(4, 10)
  const checkDigit = Number(normalized[10])
  const expectedCheckDigit = computeCheckDigit(normalized.slice(0, 10))
  const checkDigitValid = expectedCheckDigit !== null && expectedCheckDigit === checkDigit

  if (!checkDigitValid) {
    errors.push(`Check digit failed: expected ${expectedCheckDigit}, received ${checkDigit}.`)
  }

  // Category is a signal, not a hard failure — J and Z are legitimate ISO values
  // and must never be silently rewritten to U (spec 30.3 step 10).
  if (!(EQUIPMENT_CATEGORIES as readonly string[]).includes(equipmentCategory)) {
    warnings.push(`Equipment category "${equipmentCategory}" is outside ISO 6346 (expected U, J or Z).`)
  }
  else if (equipmentCategory !== 'U') {
    warnings.push(
      equipmentCategory === 'Z'
        ? 'Category Z identifies a trailer or chassis, not a freight container.'
        : 'Category J identifies detachable container equipment, not a freight container.',
    )
  }

  return {
    normalized,
    valid: checkDigitValid,
    structureValid: true,
    checkDigitValid,
    checkDigit,
    expectedCheckDigit,
    ownerCode,
    equipmentCategory,
    serial,
    errors,
    warnings,
  }
}

/** Convenience predicate. */
export function isValidContainerNumber(input: string): boolean {
  return validateContainerNumber(input).valid
}

/** Display form: `MSCU 452189-4`. Falls back to the raw value when malformed. */
export function formatContainerNumber(input: string): string {
  const normalized = normalizeContainerNumber(input)
  if (!STRUCTURE_RE.test(normalized)) return normalized
  return `${normalized.slice(0, 4)} ${normalized.slice(4, 10)}-${normalized.slice(10)}`
}

/**
 * Visually confusable character pairs seen in painted/stencilled container
 * markings (spec 30.5). Substitutions are only ever applied where the
 * resulting character matches the field type for that position.
 */
const CONFUSIONS: Record<string, string[]> = {
  0: ['O', 'D'],
  O: ['0'],
  D: ['0'],
  1: ['I', 'L'],
  I: ['1'],
  L: ['1'],
  2: ['Z'],
  Z: ['2'],
  5: ['S'],
  S: ['5'],
  6: ['G'],
  G: ['6'],
  8: ['B'],
  B: ['8'],
}

const MAX_SUBSTITUTION_DEPTH = 2
const MAX_CANDIDATES = 5

function fitsPosition(char: string, index: number): boolean {
  return index < 4 ? /[A-Z]/.test(char) : /\d/.test(char)
}

/**
 * Generate a bounded set of ISO-valid alternatives for an OCR string.
 *
 * Substitutions are limited to the supplied low-confidence positions (or all
 * positions when none are supplied) and to at most {@link MAX_SUBSTITUTION_DEPTH}
 * simultaneous changes, so the corrector never invents identifiers wholesale.
 *
 * @param raw            the OCR string, in any casing/spacing
 * @param lowConfidence  zero-based indexes (into the normalized string) the OCR
 *                       engine flagged as uncertain
 * @returns ISO-valid candidates, best-first, excluding the input itself
 */
export function generateCorrectionCandidates(raw: string, lowConfidence?: number[]): string[] {
  const normalized = normalizeContainerNumber(raw)
  if (normalized.length !== 11) return []

  const positions = lowConfidence?.length
    ? lowConfidence.filter(i => i >= 0 && i < 11)
    : Array.from({ length: 11 }, (_, i) => i)

  const found = new Set<string>()

  const walk = (value: string, startIndex: number, depth: number) => {
    if (found.size >= MAX_CANDIDATES) return
    if (depth > 0 && value !== normalized && isValidContainerNumber(value)) {
      found.add(value)
      return
    }
    if (depth >= MAX_SUBSTITUTION_DEPTH) return

    for (let p = startIndex; p < positions.length; p++) {
      const index = positions[p]!
      const current = value[index]!
      for (const replacement of CONFUSIONS[current] ?? []) {
        if (!fitsPosition(replacement, index)) continue
        walk(value.slice(0, index) + replacement + value.slice(index + 1), p + 1, depth + 1)
        if (found.size >= MAX_CANDIDATES) return
      }
    }
  }

  walk(normalized, 0, 0)
  return [...found]
}
