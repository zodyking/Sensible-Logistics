import { generateCorrectionCandidates, validateContainerNumber } from './iso6346'

/**
 * Turn raw OCR text into ranked equipment identifiers.
 *
 * Container markings are ISO 6346 (four letters + seven digits). Chassis plates
 * are often the same shape with category Z, but many fleets use a shorter
 * inventory number, so those are kept as well.
 */

export interface ParsedOcrCandidate {
  value: string
  confidence: number
  checkDigitValid: boolean
  lowConfidenceIndexes: number[]
}

const ISO_WINDOW = /^[A-Z]{4}\d{7}$/

function compactAlnum(text: string): string {
  return (text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Sliding 11-character windows that look like ISO 6346 identifiers. */
export function extractIsoWindows(text: string): string[] {
  const compact = compactAlnum(text)
  if (compact.length < 11) return compact.length === 11 && ISO_WINDOW.test(compact) ? [compact] : []

  const found: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i <= compact.length - 11; i++) {
    const slice = compact.slice(i, i + 11)
    if (!ISO_WINDOW.test(slice) || seen.has(slice)) continue
    seen.add(slice)
    found.push(slice)
  }
  return found
}

/**
 * Chassis plates are a single horizontal token, typically 4–17 characters.
 * Isolated words from the OCR line are kept so a plate like `ABC 123456` still
 * produces a usable reading when it is not ISO-shaped.
 */
export function extractChassisTokens(text: string): string[] {
  const compact = compactAlnum(text)
  const tokens = (text ?? '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 4 && t.length <= 17)

  const found: string[] = []
  const seen = new Set<string>()
  const push = (value: string) => {
    if (!value || seen.has(value)) return
    seen.add(value)
    found.push(value)
  }

  if (compact.length >= 4 && compact.length <= 17) push(compact)
  for (const token of tokens) push(token)
  for (const iso of extractIsoWindows(text)) push(iso)
  return found
}

function toCandidate(value: string, confidence: number): ParsedOcrCandidate {
  const validation = validateContainerNumber(value)
  return {
    value,
    confidence,
    checkDigitValid: validation.checkDigitValid,
    lowConfidenceIndexes: [],
  }
}

/**
 * Build candidates from one or more OCR transcripts of the same photo.
 * ISO-valid readings sort first; correction guesses from confusable letters
 * (O/0, I/1, …) are appended below what the engine actually saw.
 */
export function parseEquipmentReadings(
  texts: string[],
  profile: 'container' | 'chassis' | 'seal',
  confidence = 0.72,
): ParsedOcrCandidate[] {
  const values = new Set<string>()

  for (const text of texts) {
    if (profile === 'chassis') {
      for (const token of extractChassisTokens(text)) values.add(token)
    }
    else if (profile === 'seal') {
      const compact = compactAlnum(text)
      if (compact.length >= 4 && compact.length <= 20) values.add(compact)
    }
    else {
      for (const iso of extractIsoWindows(text)) values.add(iso)
      const compact = compactAlnum(text)
      // Keep near-ISO 11-character readings (owner code intact) so confusable
      // letters in the serial can still be corrected. Reject junk windows.
      if (compact.length === 11 && /^[A-Z]{4}/.test(compact)) values.add(compact)
    }
  }

  const primary = [...values].map(value => toCandidate(value, confidence))

  const expanded: ParsedOcrCandidate[] = [...primary]
  for (const candidate of primary) {
    if (candidate.checkDigitValid) continue
    if (candidate.value.length !== 11) continue
    for (const alternative of generateCorrectionCandidates(candidate.value)) {
      expanded.push(toCandidate(alternative, confidence * 0.8))
    }
  }

  const seen = new Set<string>()
  return expanded
    .filter((c) => {
      if (seen.has(c.value)) return false
      seen.add(c.value)
      return true
    })
    .sort((a, b) => {
      if (a.checkDigitValid !== b.checkDigitValid) return a.checkDigitValid ? -1 : 1
      if (profile === 'chassis' && a.value.length !== b.value.length) return b.value.length - a.value.length
      return b.confidence - a.confidence
    })
}
