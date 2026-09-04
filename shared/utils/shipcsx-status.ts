import type { CsxLookupTab } from './csx-lookup'

export const CSX_TAB_LABELS: Record<CsxLookupTab, string> = {
  NOTIFIED: 'Notified',
  ENROUTE: 'En route',
  IN_GATE: 'In-gate',
  OTHERS: 'Other',
  NOT_FOUND: 'Not on CSX',
}

export interface ShipcsxStatusInput {
  inGateReadiness?: string | null
  resultTab?: string | null
  waybillDate?: string | null
  gateWindow?: string | null
  loadEmpty?: string | null
  error?: string | null
  checkedAt?: Date | string | null
}

/** Short status for the ShipCSX panel. Never show raw enum underscores. */
export function shipcsxStatusLabel(snapshot: ShipcsxStatusInput | null | undefined): string {
  if (!snapshot) return 'Not checked'
  if (snapshot.error && !snapshot.inGateReadiness) return 'Couldn\'t check'
  if (snapshot.inGateReadiness?.trim()) return snapshot.inGateReadiness.trim()
  const tab = snapshot.resultTab?.replace(/-/g, '_') as CsxLookupTab | undefined
  if (tab && CSX_TAB_LABELS[tab]) return CSX_TAB_LABELS[tab]
  return 'Checked'
}

/** Driver-facing lookup failure — hide Playwright / env internals. */
export function shipcsxPublicError(raw: string | null | undefined): string {
  const text = raw?.trim() ?? ''
  if (!text) return 'Could not check ShipCSX.'
  if (/playwright is not installed/i.test(text)) {
    return 'ShipCSX lookup is not set up on this server yet.'
  }
  if (/signed-in profile|sign in once|password/i.test(text)) {
    return 'ShipCSX is not signed in on this server.'
  }
  if (/terminal name|default_terminal|NUXT_SHIPCSX_DEFAULT_TERMINAL/i.test(text)) {
    return 'Set a ShipCSX terminal name on the rail location.'
  }
  if (/challenged|captcha|blocked/i.test(text)) {
    return 'ShipCSX blocked this check. Try again later.'
  }
  if (/browser|chromium|executable/i.test(text)) {
    return 'ShipCSX lookup is not set up on this server yet.'
  }
  if (/eacces|permission denied|mkdir/i.test(text)) {
    return 'ShipCSX could not store its browser profile on this server.'
  }
  return text
}

export function shipcsxMetaLine(snapshot: ShipcsxStatusInput | null | undefined): string {
  if (!snapshot) return ''
  return [snapshot.loadEmpty, snapshot.waybillDate && `Waybill ${snapshot.waybillDate}`, snapshot.gateWindow]
    .filter(Boolean)
    .join(' · ')
}
