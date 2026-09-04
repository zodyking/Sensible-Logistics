export const SHIPCSX_LOOKUP_URL = 'https://next.shipcsx.com/#/shipment/lookup'
export const SHIPCSX_REFERENCE = '0000'
/** CSX facility names we check. Fixed list — do not scrape ShipCSX for terminals. */
export const SHIPCSX_TERMINALS = [
  'North Bergen',
  'Little Ferry',
  'South Kearny',
  'Elizabeth',
  'Newark',
] as const
export type ShipcsxTerminalName = (typeof SHIPCSX_TERMINALS)[number]
export const SHIPCSX_BATCH_SIZE = 3
export const SHIPCSX_POLL_INTERVAL_MS = 30 * 60 * 1000
/** Client + server wait for a live Playwright lookup (public search, no login). */
export const SHIPCSX_CHECK_TIMEOUT_MS = 120_000
export const SHIPCSX_TIMEZONE = 'America/New_York'
export const SHIPCSX_POLL_START_HOUR = 5
export const SHIPCSX_POLL_END_HOUR = 22

export const CSX_LOOKUP_TABS = ['NOTIFIED', 'ENROUTE', 'IN_GATE', 'OTHERS', 'NOT_FOUND'] as const
export type CsxLookupTab = (typeof CSX_LOOKUP_TABS)[number]

export interface CsxLookupCard {
  equipmentNumber: string
  loadEmpty: string | null
  waybillDate: string | null
  inGateReadiness: string | null
  gateWindow: string | null
  resultTab: CsxLookupTab
}

export interface CsxLookupParseResult {
  cards: CsxLookupCard[]
  tabCounts: Partial<Record<Exclude<CsxLookupTab, 'NOT_FOUND'>, number>>
}

const TAB_ALIASES: Record<string, Exclude<CsxLookupTab, 'NOT_FOUND'>> = {
  'NOTIFIED': 'NOTIFIED',
  'ENROUTE': 'ENROUTE',
  'EN-ROUTE': 'ENROUTE',
  'IN-GATE': 'IN_GATE',
  'INGATE': 'IN_GATE',
  'IN GATE': 'IN_GATE',
  'OTHERS': 'OTHERS',
}

function compactEquip(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function labelValue(block: string, labels: string[]): string | null {
  for (const label of labels) {
    const match = block.match(new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]+)`, 'i'))
    const value = match?.[1]?.trim()
    if (value) return value.replace(/\s+/g, ' ')
  }
  return null
}

function tabFromHeading(heading: string): Exclude<CsxLookupTab, 'NOT_FOUND'> | null {
  const key = heading.toUpperCase().replace(/\s+/g, ' ').trim()
  return TAB_ALIASES[key] ?? TAB_ALIASES[key.replace(/[^A-Z]/g, '')] ?? null
}

/**
 * Parse ShipCSX "Shipment Lookup Results" page text. Never used to book
 * a reservation — availability / Submit copy is ignored.
 */
export function parseShipcsxLookupText(text: string): CsxLookupParseResult {
  const source = text ?? ''
  const tabCounts: CsxLookupParseResult['tabCounts'] = {}

  for (const match of source.matchAll(/(NOTIFIED|ENROUTE|EN-ROUTE|IN-GATE|IN GATE|OTHERS)\s*\((\d+)\)/gi)) {
    const tab = tabFromHeading(match[1] ?? '')
    if (tab) tabCounts[tab] = Number(match[2])
  }

  const cards: CsxLookupCard[] = []
  const cardBlocks = source.split(/(?=[A-Z]{4}\s?\d{6,7})/g)

  for (const block of cardBlocks) {
    const equipMatch = block.match(/\b([A-Z]{4})\s?(\d{6,7})\b/)
    if (!equipMatch) continue
    const equipmentNumber = compactEquip(`${equipMatch[1]}${equipMatch[2]}`)
    if (equipmentNumber.length < 10) continue
    if (/RESERVATION|SUBMIT|AVAILABLE/.test(block.toUpperCase()) && !/WAYBILL|IN-GATE|LOAD/.test(block.toUpperCase())) {
      continue
    }

    let resultTab: CsxLookupTab = 'NOT_FOUND'
    const active = Object.entries(tabCounts).find(([, count]) => (count ?? 0) > 0)?.[0] as CsxLookupTab | undefined
    if (active) resultTab = active
    if (/READY TO IN-GATE|READY TO INGATE/i.test(block)) resultTab = 'IN_GATE'
    else if (/ENROUTE|EN-ROUTE/i.test(block) && !/IN-GATE/i.test(block)) resultTab = 'ENROUTE'
    else if (/NOTIFIED/i.test(block) && !/IN-GATE/i.test(block)) resultTab = 'NOTIFIED'

    cards.push({
      equipmentNumber,
      loadEmpty: labelValue(block, ['Load / Empty', 'Load/Empty']),
      waybillDate: labelValue(block, ['Waybill Date']),
      inGateReadiness: labelValue(block, ['In-Gate Readiness', 'In Gate Readiness']),
      gateWindow: labelValue(block, ['Gate Window']),
      resultTab,
    })
  }

  return { cards, tabCounts }
}

export function matchLookupCard(cards: CsxLookupCard[], equipmentNumber: string): CsxLookupCard | null {
  const needle = compactEquip(equipmentNumber)
  return cards.find(card => compactEquip(card.equipmentNumber) === needle) ?? null
}

/** 05:00 inclusive through 22:00 exclusive in America/New_York. */
export function isShipcsxPollWindow(now: Date, timeZone = SHIPCSX_TIMEZONE): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(now))
  return hour >= SHIPCSX_POLL_START_HOUR && hour < SHIPCSX_POLL_END_HOUR
}

export function chunkShipcsxEquipment<T>(items: T[], size = SHIPCSX_BATCH_SIZE): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}

/** ShipCSX Equipment Lookup uses a 4-letter initial and 6-digit serial (no check digit). */
export interface ShipcsxEquipmentParts {
  initial: string
  number: string
}

export function shipcsxEquipmentParts(equipmentNumber: string): ShipcsxEquipmentParts | null {
  const compact = compactEquip(equipmentNumber)
  const match = compact.match(/^([A-Z]{4})(\d{6})/)
  if (!match?.[1] || !match[2]) return null
  return { initial: match[1], number: match[2] }
}

/** Map a stored or typed name onto the five CSX facilities, else North Bergen. */
export function pickShipcsxTerminal(wanted?: string | null): ShipcsxTerminalName {
  const match = matchShipcsxTerminalOption([...SHIPCSX_TERMINALS], wanted ?? '')
  return (match as ShipcsxTerminalName | null) ?? SHIPCSX_TERMINALS[0]
}

/** Prefer a live trip or rail name when it matches a CSX facility we check. */
export function resolveShipcsxTerminalName(input: {
  destTerminal?: string | null
  destName?: string | null
  destType?: string | null
  railTerminal?: string | null
  railName?: string | null
  defaultTerminal?: string | null
} = {}): ShipcsxTerminalName {
  const candidates = [
    input.destTerminal,
    input.destType === 'RAIL_TERMINAL' ? input.destName : null,
    input.railTerminal,
    input.defaultTerminal,
    input.railName,
  ]
  for (const value of candidates) {
    const match = matchShipcsxTerminalOption([...SHIPCSX_TERMINALS], value || '')
    if (match) return match as ShipcsxTerminalName
  }
  return SHIPCSX_TERMINALS[0]
}

/** Pick the ShipCSX dropdown label that matches the rail location's stored name. */
export function matchShipcsxTerminalOption(options: string[], wanted: string): string | null {
  const needle = wanted.trim().toLowerCase()
  if (!needle) return null
  const cleaned = options
    .map(option => option.replace(/\s+/g, ' ').trim())
    .filter(option => option && !/^select(\s+terminal)?$/i.test(option))
  const exact = cleaned.find(option => option.toLowerCase() === needle)
  if (exact) return exact
  const starts = cleaned.find((option) => {
    const label = option.toLowerCase()
    return label.startsWith(needle) || needle.startsWith(label)
  })
  if (starts) return starts
  const includes = cleaned.filter((option) => {
    const label = option.toLowerCase()
    return label.includes(needle) || needle.includes(label)
  })
  return includes.length === 1 ? (includes[0] ?? null) : null
}

export function cleanShipcsxTerminalNames(labels: string[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const raw of labels) {
    const name = raw.replace(/\s+/g, ' ').trim()
    if (!name) continue
    if (/^select(\s+terminal)?$/i.test(name)) continue
    if (/^(ok|done|cancel|search|continue)$/i.test(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    names.push(name)
  }
  return names.sort((a, b) => a.localeCompare(b))
}

export function shipcsxPageLooksHardBlocked(text: string): boolean {
  const body = text ?? ''
  if (/shipment lookup|equipment initial|select terminal/i.test(body)) return false
  return /you have been blocked|access denied|unusual traffic|captcha|cf-error|attention required|enable cookies/i.test(body)
}

export function shipcsxPageLooksLikeChallenge(text: string): boolean {
  return /just a moment|checking your browser|verify you are human/i.test(text ?? '')
}

export function shipcsxPageLooksLikeLogin(text: string, url = ''): boolean {
  const body = (text ?? '').toLowerCase()
  if (/shipment lookup|equipment initial/.test(body)) return false
  if (url.includes('shipment/lookup')) return false
  return /sign in|log in/.test(body) && /password/.test(body)
}
