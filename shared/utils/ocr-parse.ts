import { generateCorrectionCandidates, maskChassisInput, validateContainerNumber } from './iso6346'

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
const CHASSIS_WINDOW = /^[A-Z]{4}\d{6}$/

function compactAlnum(text: string): string {
  return (text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** True when Tesseract wrote a TSV table rather than the words it read. */
export function isTesseractTsv(text: string): boolean {
  const line = (text ?? '').split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? ''
  if (/^level\tpage_num\t/i.test(line)) return true
  const tabs = line.split('\t')
  return tabs.length >= 10 && /^\d+$/.test(tabs[0] ?? '') && /^\d+$/.test(tabs[1] ?? '')
}

export function visibleOcrTranscript(text: string): string {
  if (!text || isTesseractTsv(text)) return ''
  const compact = compactAlnum(text)
  if (!/[A-Z]{3,}/.test(compact)) return ''
  return text.replace(/\s+/g, ' ').trim().slice(0, 80)
}

const FALLBACK_READ_MESSAGE = 'No container number could be read. Frame the four letters and seven digits, then retake.'

/** Hide Python errno / traceback text from the driver UI. */
export function driverOcrMessage(raw: string | undefined, fallback = FALLBACK_READ_MESSAGE): string {
  const text = (raw ?? '').trim()
  if (!text) return fallback
  if (/errno|permission denied|e2e_results|traceback|no such file|oserror/i.test(text)) {
    return fallback
  }
  return text
}

/** Join letter-only prefixes with the digit groups that follow (stacked door codes). */
export function stitchOcrFragments(texts: string[]): string[] {
  const extra: string[] = []
  extra.push(texts.join(' '))
  extra.push(texts.join(''))
  const tokens = texts.flatMap(text =>
    (text ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean),
  )
  extra.push(tokens.join(''))
  extra.push(tokens.join(' '))
  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i]!
    const b = tokens[i + 1]
    const c = tokens[i + 2]
    if (b && /^[A-Z]{4}$/.test(a) && /^\d{6,7}$/.test(b)) extra.push(a + b)
    if (b && c && /^[A-Z]{4}$/.test(a) && /^\d{6}$/.test(b) && /^\d$/.test(c)) extra.push(a + b + c)
  }
  return [...texts, ...extra]
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
  for (const plate of extractChassisWindows(text)) push(plate)
  for (const iso of extractIsoWindows(text)) push(iso)
  return found
}

/**
 * Chassis plates are four letters and six digits — no boxed check digit.
 * Skip 10-character prefixes of an 11-character container number in the same text.
 */
export function extractChassisWindows(text: string): string[] {
  const compact = compactAlnum(text)
  const isos = new Set(extractIsoWindows(text))
  const found: string[] = []
  const seen = new Set<string>()
  const push = (value: string) => {
    if (!value || seen.has(value) || !CHASSIS_WINDOW.test(value)) return
    if ([...isos].some(iso => iso.startsWith(value))) return
    seen.add(value)
    found.push(value)
  }

  if (compact.length === 10) push(compact)
  for (let i = 0; i <= compact.length - 10; i++) {
    push(compact.slice(i, i + 10))
  }
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
      if (isTesseractTsv(text)) continue
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

export interface ClassifiedEquipment {
  container: string | null
  chassis: string | null
  containerCandidates: ParsedOcrCandidate[]
  chassisCandidates: ParsedOcrCandidate[]
}

/**
 * Split one photo's OCR lines into a container (4 letters + 7 digits) and a
 * chassis / trailer plate (4 letters + 6 digits, no dash).
 */
export function classifyEquipmentReadings(
  texts: string[],
  confidence = 0.72,
): ClassifiedEquipment {
  const merged = stitchOcrFragments(texts)
  const seenWindows = new Set<string>()
  const windows: string[] = []
  for (const text of merged) {
    for (const iso of extractIsoWindows(text)) {
      if (seenWindows.has(iso)) continue
      seenWindows.add(iso)
      windows.push(iso)
    }
  }

  const containerCandidates = parseEquipmentReadings(merged, 'container', confidence)
  const container = windows.find(value => validateContainerNumber(value).checkDigitValid)
    ?? windows[0]
    ?? containerCandidates[0]?.value
    ?? null

  const chassisValues = new Set<string>()
  for (const text of merged) {
    for (const token of extractChassisWindows(text)) {
      if (container && container.startsWith(token)) continue
      chassisValues.add(maskChassisInput(token))
    }
  }

  const chassisCandidates = [...chassisValues].map(value => ({
    value,
    confidence,
    checkDigitValid: false,
    lowConfidenceIndexes: [],
  }))

  return {
    container,
    chassis: chassisCandidates[0]?.value ?? null,
    containerCandidates,
    chassisCandidates,
  }
}
