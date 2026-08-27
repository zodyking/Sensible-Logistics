import { computeCheckDigit, generateCorrectionCandidates, maskChassisInput, validateContainerNumber } from './iso6346'

/**
 * Turn raw OCR text into ranked equipment identifiers.
 *
 * Container markings are ISO 6346 (four letters + seven digits). Chassis plates
 * are often the same shape with category Z, but many fleets use a shorter
 * inventory number, so those are kept as well.
 *
 * Identifiers are only ever read from a single OCR transcript, never from
 * several transcripts concatenated together: sliding a window across joined
 * label text produces check-digit-valid numbers that were never painted on the
 * equipment (a bumper sticker reading METRO-POOL next to a serial once became
 * OLBS0835260). Spatial ordering is the OCR worker's job; this module only
 * validates and repairs what one region actually said.
 */

export interface ParsedOcrCandidate {
  value: string
  confidence: number
  checkDigitValid: boolean
  lowConfidenceIndexes: number[]
}

const ISO_WINDOW = /^[A-Z]{4}\d{7}$/
const CHASSIS_WINDOW = /^[A-Z]{4}\d{6}$/
// Only freight containers (category U) get a computed check digit: a Z plate is
// a chassis and a J token is detachable equipment, neither of which is boxed.
const ISO_PREFIX = /^[A-Z]{3}U\d{6}$/

function compactAlnum(text: string): string {
  const compact = (text ?? '')
    .replace(/[一丨│｜二]/g, 'I')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  // A boxed glyph can read as a run of I bars; collapse it to one letter.
  return /^I{2,3}$/.test(compact) ? 'I' : compact
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

/**
 * Rebuild readings that one region split across neighbouring transcripts.
 *
 * Only adjacent fragments are joined, and only in the shapes a painted marking
 * actually takes: a run of single glyphs, or an owner code immediately followed
 * by its serial. Whole-list concatenation is deliberately absent.
 */
export function stitchOcrFragments(texts: string[]): string[] {
  const tokens = texts.map(text => compactAlnum(text)).filter(Boolean)
  const extra: string[] = []

  let run: string[] = []
  const flushRun = () => {
    if (run.length >= 4) extra.push(run.join(''))
    run = []
  }
  for (const token of tokens) {
    if (token.length === 1) run.push(token)
    else flushRun()
  }
  flushRun()

  for (let i = 0; i < tokens.length; i++) {
    const a = tokens[i]!
    const b = tokens[i + 1]
    const c = tokens[i + 2]
    if (b && /^[A-Z]{4}$/.test(a) && /^\d{6,7}$/.test(b)) extra.push(a + b)
    if (b && c && /^[A-Z]{4}$/.test(a) && /^\d{6}$/.test(b) && /^\d$/.test(c)) extra.push(a + b + c)
  }

  return [...texts, ...extra]
}

/** Stacked OCR sometimes prepends a junk 0 onto the six-digit serial. */
export function repairLeadingZeroIso(value: string): string | null {
  const compact = compactAlnum(value)
  if (!/^[A-Z]{3}U0\d{6}$/.test(compact)) return null
  if (validateContainerNumber(compact).checkDigitValid) return null
  const prefix = compact.slice(0, 4) + compact.slice(5, 11)
  const digit = computeCheckDigit(prefix)
  if (digit === null) return null
  const repaired = prefix + String(digit)
  return validateContainerNumber(repaired).checkDigitValid ? repaired : null
}

/**
 * ISO 6346 identifiers inside one transcript.
 *
 * A reading must be the whole token, or sit at its start followed by something
 * that is not another digit — the boundary that stops label text from being
 * spliced into an identifier.
 */
export function extractIsoWindows(text: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const push = (value: string) => {
    if (!value || seen.has(value)) return
    seen.add(value)
    found.push(value)
  }

  for (const candidate of isoCandidateTokens(text)) {
    if (candidate.length === 11 && (ISO_WINDOW.test(candidate) || isNearIsoWindow(candidate))) {
      push(candidate)
      const repaired = repairLeadingZeroIso(candidate)
      if (repaired) push(repaired)
    }
    // Stacked door codes often drop the boxed check digit; ISO lets us compute it.
    if (candidate.length === 10 && ISO_PREFIX.test(candidate)) {
      const digit = computeCheckDigit(candidate)
      if (digit !== null) push(candidate + String(digit))
    }
  }

  return found
}

/**
 * Tokens from one transcript that may stand alone as an identifier: each
 * separated word, and the compacted whole when no further digits follow it.
 *
 * A reading is never taken from the middle of a longer run of characters —
 * that is how a joined row such as BSIU811694UPERHEAVAIMZ481345 used to yield
 * BSIU811694, a prefix of label soup rather than a marking.
 */
function isoCandidateTokens(text: string): string[] {
  const compact = compactAlnum(text)
  const tokens = new Set<string>()
  for (const word of (text ?? '').toUpperCase().split(/[^A-Z0-9]+/)) {
    const clean = compactAlnum(word)
    if (clean.length === 10 || clean.length === 11) tokens.add(clean)
  }
  for (const length of [10, 11]) {
    if (compact.length >= length && !/\d/.test(compact.slice(length))) {
      tokens.add(compact.slice(0, length))
    }
  }
  return [...tokens]
}

/** 11-char token whose owner code may contain I/1 (or O/0) confusions. */
function isNearIsoWindow(value: string): boolean {
  if (!/^[A-Z0-9]{4}\d{7}$/.test(value)) return false
  if (ISO_WINDOW.test(value)) return true
  return /[A-Z]/.test(value.slice(0, 4))
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
  if (compact.length > 10 && /\d/.test(compact[10] ?? '')) return []

  const plate = compact.slice(0, 10)
  if (!CHASSIS_WINDOW.test(plate)) return []
  if ([...isos].some(iso => iso.startsWith(plate))) return []
  return [plate]
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
      // Keep whole 11-character readings whose owner code survived, so a
      // confusable character in the serial can still be corrected below.
      const compact = compactAlnum(text)
      if (compact.length === 11 && /^[A-Z]{4}/.test(compact)) values.add(compact)
      if (compact.length === 11 && isNearIsoWindow(compact)) values.add(compact)
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
 *
 * A container is only returned when the check digit proves it, or when a single
 * OCR transcript read all eleven characters. Anything less stays null so the
 * driver is asked to retake or type it instead of being handed a wrong number.
 */
/**
 * Serials that some transcript saw carrying an explicit category U.
 *
 * A rib photographed on its side reads the U as I or L, so the owner code comes
 * back as BSII/BSIL. The category may only be restored when another region of
 * the same photo read `U` in front of the very same six digits.
 */
function corroboratedUSerials(texts: string[]): Set<string> {
  const serials = new Set<string>()
  for (const text of texts) {
    for (const match of compactAlnum(text).matchAll(/U(\d{6})(?!\d)/g)) {
      serials.add(match[1]!)
    }
  }
  return serials
}

function restoreCategoryU(texts: string[], serials: Set<string>): string[] {
  if (!serials.size) return []

  const restored: string[] = []
  for (const text of texts) {
    const match = compactAlnum(text).match(/^([A-Z]{3})([A-Z])(\d{6})$/)
    if (!match) continue
    const [, owner, category, serial] = match
    if (category === 'U' || category === 'J' || category === 'Z') continue
    if (!serials.has(serial!)) continue
    const digit = computeCheckDigit(`${owner}U${serial}`)
    if (digit !== null) restored.push(`${owner}U${serial}${digit}`)
  }
  return restored
}

export function classifyEquipmentReadings(
  texts: string[],
  confidence = 0.72,
): ClassifiedEquipment {
  const uSerials = corroboratedUSerials(texts)
  const merged = [...stitchOcrFragments(texts), ...restoreCategoryU(texts, uSerials)]

  const chassisValues = new Set<string>()
  for (const text of merged) {
    for (const token of extractChassisWindows(text)) {
      const plate = maskChassisInput(token)
      // A door code read without its boxed check digit is the same shape as a
      // plate; the container serial it carries keeps it out of this field.
      if (uSerials.has(plate.slice(4))) continue
      chassisValues.add(plate)
    }
  }

  const native = new Set(parseEquipmentReadings(texts, 'container', confidence).map(c => c.value))
  const containerCandidates = parseEquipmentReadings(merged, 'container', confidence)
    .filter(candidate => !chassisValues.has(candidate.value.slice(0, 10)))

  const valid = containerCandidates.filter(candidate => candidate.checkDigitValid)
  const container = valid.find(candidate => native.has(candidate.value))?.value
    ?? valid[0]?.value
    ?? containerCandidates.find(candidate => native.has(candidate.value))?.value
    ?? null

  const chassisCandidates = [...chassisValues]
    .filter(value => !(container && container.startsWith(value)))
    .map(value => ({
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
