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
  terminalName?: string | null
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
  if (/login wall|signed-in profile|sign in once|password/i.test(text)) {
    return 'ShipCSX asked for a login. Shipment lookup should work without an account.'
  }
  if (/not in the dropdown|could not select|choose a csx location/i.test(text)) {
    return 'Choose a CSX location on Check CSX and try again.'
  }
  if (/terminal name|default_terminal|NUXT_SHIPCSX_DEFAULT_TERMINAL|rail location/i.test(text)) {
    return 'Choose a CSX location on Check CSX and try again.'
  }
  if (/challenged|captcha|blocked/i.test(text)) {
    return 'ShipCSX blocked this check. Try again later.'
  }
  if (/locator\.|timeout \d+ms exceeded|getByRole|waiting for|did not load|never became|did not return lookup results/i.test(text)) {
    return 'ShipCSX search never became ready. Check the CSX location and try again.'
  }
  if (/browser|chromium|executable/i.test(text)) {
    return 'ShipCSX lookup is not set up on this server yet.'
  }
  if (/eacces|permission denied|mkdir/i.test(text)) {
    return 'Couldn\'t open the ShipCSX browser on this server.'
  }
  return text
}

export function shipcsxMetaLine(snapshot: ShipcsxStatusInput | null | undefined): string {
  if (!snapshot) return ''
  return [
    snapshot.terminalName,
    snapshot.loadEmpty,
    snapshot.waybillDate && `Waybill ${snapshot.waybillDate}`,
    snapshot.gateWindow,
  ]
    .filter(Boolean)
    .join(' · ')
}
