import { normalizeContainerNumber } from './iso6346'

export interface CsxListLine {
  text: string
  y?: number
}

export interface CsxListPair {
  containerNumber: string
  pickupNumber: string
  confidence: 'high' | 'guess'
}

export interface CsxListParseResult {
  pairs: CsxListPair[]
  leftoverContainers: string[]
  leftoverPickups: string[]
}

const ISO_TOKEN = /^[A-Z]{4}\d{6,7}$/
const PICKUP_TOKEN = /^[A-Z0-9]{4,16}$/

function compactToken(text: string): string {
  return (text ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function tokensInLine(text: string): string[] {
  const compact = compactToken(text)
  if (!compact) return []
  const found: string[] = compact.match(/[A-Z]{4}\d{6,7}/g) ?? []
  const rest = compact
  let remainder = rest
  for (const token of found) remainder = remainder.replace(token, ' ')
  for (const token of remainder.split(/[^A-Z0-9]+/).map(compactToken).filter(Boolean)) {
    if (isPickupToken(token)) found.push(token)
  }
  if (found.length) return found
  if (PICKUP_TOKEN.test(compact) && /\d/.test(compact)) return [compact]
  return compact.split(/[^A-Z0-9]+/).map(compactToken).filter(Boolean)
}

function isContainerToken(token: string): boolean {
  return ISO_TOKEN.test(token)
}

function isPickupToken(token: string): boolean {
  if (!PICKUP_TOKEN.test(token)) return false
  if (isContainerToken(token)) return false
  if (token === '00' || token === '0') return false
  return /[A-Z]/.test(token) || token.length >= 5
}

/**
 * Pair ISO container markings with nearby pickup / reference numbers
 * from a two-column list or alternating lines. Guessed leftover pairs
 * are marked so the review screen can confirm them.
 */
export function parseCsxPickupList(lines: Array<string | CsxListLine>): CsxListParseResult {
  const rows = lines
    .map((line) => {
      if (typeof line === 'string') return { text: line, y: undefined as number | undefined }
      return line
    })
    .filter(row => row.text.trim())
    .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))

  const pairs: CsxListPair[] = []
  const leftoverContainers: string[] = []
  const leftoverPickups: string[] = []
  const used = new Set<string>()

  for (const row of rows) {
    const tokens = tokensInLine(row.text)
    const containers = tokens.filter(isContainerToken)
    const pickups = tokens.filter(isPickupToken)
    if (containers.length === 1 && pickups.length === 1) {
      const containerNumber = normalizeContainerNumber(containers[0]!)
      const pickupNumber = pickups[0]!
      const key = `${containerNumber}:${pickupNumber}`
      if (used.has(key)) continue
      used.add(key)
      pairs.push({ containerNumber, pickupNumber, confidence: 'high' })
    }
    else {
      leftoverContainers.push(...containers.map(normalizeContainerNumber))
      leftoverPickups.push(...pickups)
    }
  }

  const leftoverC = leftoverContainers.filter((value, index, list) => list.indexOf(value) === index)
  const leftoverP = leftoverPickups.filter((value, index, list) => list.indexOf(value) === index)

  const unpairedC = leftoverC.filter(value => !pairs.some(pair => pair.containerNumber === value))
  const unpairedP = leftoverP.filter(value => !pairs.some(pair => pair.pickupNumber === value))

  const guessed: CsxListPair[] = []
  const n = Math.min(unpairedC.length, unpairedP.length)
  for (let i = 0; i < n; i++) {
    guessed.push({
      containerNumber: unpairedC[i]!,
      pickupNumber: unpairedP[i]!,
      confidence: 'guess',
    })
  }

  return {
    pairs: [...pairs, ...guessed],
    leftoverContainers: unpairedC.slice(n),
    leftoverPickups: unpairedP.slice(n),
  }
}

export function parseCsxPickupTranscript(text: string): CsxListParseResult {
  return parseCsxPickupList((text ?? '').split(/\r?\n/))
}
