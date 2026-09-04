export const SHIPCSX_LOOKUP_URL = 'https://next.shipcsx.com/#/shipment/lookup'
export const SHIPCSX_REFERENCE = '00'
export const SHIPCSX_BATCH_SIZE = 3
export const SHIPCSX_POLL_INTERVAL_MS = 30 * 60 * 1000
/** Client + server wait for a live Playwright lookup (login + search). */
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
