import { generateCorrectionCandidates, maskChassisInput, validateContainerNumber, computeCheckDigit } from './iso6346'

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
  const compact = (text ?? '')
    .replace(/[一丨│｜二]/g, 'I')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
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

const LABEL_DENY = new Set([
  'ONLY', 'LED', 'HEAV', 'UPER', 'SUPER', 'HEAVY', 'POOL', 'METRO',
  'DORSEY', 'TROPICAL', 'CAUTION', 'HIGH', 'WARNING', 'NOTICE',
  'AMAZON', 'METROPOOL', 'OUTOOOOA', 'CHINA',
])

function permute<T>(items: T[], count: number): T[][] {
  if (count <= 0) return [[]]
  const out: T[][] = []
  const used = items.map(() => false)
  const acc: T[] = []
  const walk = () => {
    if (acc.length === count) {
      out.push([...acc])
      return
    }
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue
      used[i] = true
      acc.push(items[i]!)
      walk()
      acc.pop()
      used[i] = false
    }
  }
  walk()
  return out
}

function ownerCandidates(frags: string[]): string[] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const frag of frags) {
    if (!frag || LABEL_DENY.has(frag) || seen.has(frag)) continue
    if (!/^[A-Z]{1,4}$/.test(frag)) continue
    seen.add(frag)
    unique.push(frag)
  }
  const owners = new Set<string>()
  for (const frag of unique) {
    if (/^[A-Z]{3}U$/.test(frag)) owners.add(frag)
  }
  const subset = unique.slice(0, 8)
  for (const count of [2, 3]) {
    for (const parts of permute(subset, count)) {
      const joined = parts.join('')
      if (/^[A-Z]{3}U$/.test(joined)) owners.add(joined)
    }
  }
  const hasI = unique.some(frag => frag === 'I' || (frag.length <= 2 && frag.includes('I')))
  const hasU = unique.some(frag => frag === 'U' || frag.endsWith('U'))
  if (hasU && !hasI) {
    for (const frag of unique) {
      if (/^[A-Z]{2}$/.test(frag) && frag[1] !== 'U') owners.add(`${frag}IU`)
    }
  }
  const twoLetter = unique.filter(frag => frag.length === 2 && frag[1] !== 'U')
  if (twoLetter.length) {
    return [...owners].filter(owner => twoLetter.some(prefix => owner.startsWith(prefix)))
  }
  return [...owners]
}

/**
 * Rebuild a stacked door code from short OCR glyphs without using the chassis
 * plate's six-digit serial (that join is check-digit-valid and wrong).
 */
export function assembleStackedIso(texts: string[]): string[] {
  const tokens = texts.map(text => compactAlnum(text)).filter(Boolean)
  const chassisSerials = new Set<string>()
  const chassisOwners = new Set<string>()
  for (const token of tokens) {
    if (/^[A-Z]{4}\d{6}$/.test(token)) {
      chassisOwners.add(token.slice(0, 4))
      chassisSerials.add(token.slice(4))
    }
  }

  const letterFrags: string[] = []
  const serials: string[] = []
  const addLetter = (value: string) => {
    if (value && !letterFrags.includes(value) && !chassisOwners.has(value) && !LABEL_DENY.has(value)) {
      letterFrags.push(value)
    }
  }
  const addSerial = (value: string) => {
    if (!/^\d{6,7}$/.test(value)) return
    // 7 digits starting with 0 is almost always a junk glyph in front of the serial.
    if (/^0\d{6}$/.test(value)) return
    if (chassisSerials.has(value) || chassisSerials.has(value.slice(-6))) return
    if (!serials.includes(value)) serials.push(value)
  }

  for (const token of tokens) {
    if (LABEL_DENY.has(token) || chassisOwners.has(token)) continue
    const glued = token.match(/^([A-Z]{1,3}U)(\d{6,7})$/)
    if (glued) {
      addLetter(glued[1]!)
      addSerial(glued[2]!)
      continue
    }
    if (/^U\d{6,7}$/.test(token)) {
      addLetter('U')
      addSerial(token.slice(1))
      continue
    }
    if (/^\d{6,7}$/.test(token)) {
      addSerial(token)
      continue
    }
    if (/^[A-Z]{1,4}$/.test(token)) addLetter(token)
  }

  const extra: string[] = []
  for (const owner of ownerCandidates(letterFrags)) {
    for (const serial of serials) extra.push(owner + serial)
  }
  return extra
}

/** Join letter-only prefixes with the digit groups that follow (stacked door codes). */
export function stitchOcrFragments(texts: string[]): string[] {
  const extra: string[] = []
  extra.push(texts.join(' '))
  extra.push(texts.join(''))
  const tokens = texts.flatMap(text =>
    compactAlnum(text).length ? [compactAlnum(text)] : [],
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
  extra.push(...assembleStackedIso(texts))
  extra.push(...assembleStackedIso(tokens))
  return [...texts, ...extra]
}

/** Stacked OCR often prepends a junk 0 onto the six-digit serial. */
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

/** Sliding 11-character windows that look like ISO 6346 identifiers. */
export function extractIsoWindows(text: string): string[] {
  const compact = compactAlnum(text)
  const found: string[] = []
  const seen = new Set<string>()
  const push = (value: string) => {
    if (!value || seen.has(value)) return
    seen.add(value)
    found.push(value)
  }

  if (compact.length >= 11) {
    for (let i = 0; i <= compact.length - 11; i++) {
      const slice = compact.slice(i, i + 11)
      if (ISO_WINDOW.test(slice) || isNearIsoWindow(slice)) {
        push(slice)
        const repaired = repairLeadingZeroIso(slice)
        if (repaired) push(repaired)
      }
    }
  }

  // Stacked door codes often drop the boxed check digit. Only complete when the
  // whole token is a 10-character freight prefix — sliding this over bumper
  // stickers invents check-digit-valid fakes like LBSU8352609.
  if (compact.length === 10 && /^[A-Z]{3}U\d{6}$/.test(compact)) {
    const digit = computeCheckDigit(compact)
    if (digit !== null) push(compact + String(digit))
  }

  return found
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
      if (compact.length === 11 && isNearIsoWindow(compact)) values.add(compact)
      const repaired = repairLeadingZeroIso(compact)
      if (repaired) values.add(repaired)
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

  const chassisValues = new Set<string>()
  for (const text of merged) {
    for (const token of extractChassisWindows(text)) {
      chassisValues.add(maskChassisInput(token))
    }
  }
  const chassisSerials = new Set(
    [...chassisValues].map(value => value.slice(4)).filter(serial => serial.length === 6),
  )

  const nativeEleven = new Set<string>()
  for (const text of texts) {
    const compact = compactAlnum(text)
    if (compact.length === 11 && (ISO_WINDOW.test(compact) || isNearIsoWindow(compact))) {
      nativeEleven.add(compact)
      for (const alternative of generateCorrectionCandidates(compact)) nativeEleven.add(alternative)
    }
  }

  const containerCandidates = parseEquipmentReadings(merged, 'container', confidence)
    .filter((candidate) => {
      if (candidate.value.length !== 11) return true
      const serial = candidate.value.slice(4, 10)
      if (chassisSerials.has(serial) && !nativeEleven.has(candidate.value)) return false
      return true
    })

  const valid = containerCandidates.filter(candidate => candidate.checkDigitValid)
  const container = valid.find(candidate => nativeEleven.has(candidate.value))?.value
    ?? valid.find(candidate => !chassisSerials.has(candidate.value.slice(4, 10)))?.value
    ?? windows.find(value => validateContainerNumber(value).checkDigitValid)
    ?? valid[0]?.value
    ?? windows[0]
    ?? containerCandidates[0]?.value
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
