import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  companies,
  containers,
  csxPollState,
  csxShipmentSnapshots,
  locations,
  trips,
} from '../database/schema'
import type { Database } from '../utils/db'
import { defaultShipcsxTerminal, lookupShipcsxShipments } from './shipcsx-browser'
import {
  SHIPCSX_POLL_INTERVAL_MS,
  SHIPCSX_REFERENCE,
  isShipcsxPollWindow,
  type CsxLookupTab,
} from '#shared/utils/csx-lookup'
import { normalizeContainerNumber } from '#shared/utils/iso6346'

export interface ShipcsxEligibleBox {
  containerId: string
  equipmentNumber: string
  terminal: string
}

export async function resolveShipcsxTerminal(
  db: Database,
  companyId: string,
  containerId: string,
): Promise<string> {
  const [live] = await db
    .select({
      destTerminal: locations.shipcsxTerminal,
      destName: locations.name,
      destType: locations.type,
    })
    .from(trips)
    .leftJoin(locations, eq(locations.id, trips.destinationLocationId))
    .where(and(
      eq(trips.companyId, companyId),
      eq(trips.containerId, containerId),
      inArray(trips.status, ['DRAFT', 'PICKUP_IN_PROGRESS', 'IN_TRANSIT', 'DROPOFF_IN_PROGRESS']),
    ))
    .limit(1)

  if (live?.destTerminal) return live.destTerminal
  if (live?.destType === 'RAIL_TERMINAL' && live.destName) return live.destName

  const [rail] = await db
    .select({ shipcsxTerminal: locations.shipcsxTerminal, name: locations.name })
    .from(locations)
    .where(and(
      eq(locations.companyId, companyId),
      eq(locations.type, 'RAIL_TERMINAL'),
      isNull(locations.deletedAt),
    ))
    .limit(1)

  return rail?.shipcsxTerminal || defaultShipcsxTerminal() || rail?.name || ''
}

export async function listCustomerBoxesForShipcsx(
  db: Database,
  companyId: string,
  locationId?: string,
): Promise<ShipcsxEligibleBox[]> {
  const rows = await db
    .select({
      containerId: containers.id,
      number: containers.number,
      numberNormalized: containers.numberNormalized,
      locationId: locations.id,
    })
    .from(containers)
    .innerJoin(locations, eq(locations.id, containers.currentLocationId))
    .where(and(
      eq(containers.companyId, companyId),
      eq(containers.activePoolState, 'AT_LOCATION'),
      eq(locations.type, 'CUSTOMER'),
      isNull(containers.deletedAt),
      ...(locationId ? [eq(locations.id, locationId)] : []),
    ))

  const result: ShipcsxEligibleBox[] = []
  for (const row of rows) {
    const terminal = await resolveShipcsxTerminal(db, companyId, row.containerId)
    if (!terminal) continue
    result.push({
      containerId: row.containerId,
      equipmentNumber: row.numberNormalized || normalizeContainerNumber(row.number),
      terminal,
    })
  }
  return result
}

export async function recordShipcsxHits(
  db: Database,
  companyId: string,
  hits: Array<{
    containerId: string | null
    equipmentNumber: string
    terminal: string
    resultTab: CsxLookupTab
    loadEmpty: string | null
    waybillDate: string | null
    inGateReadiness: string | null
    gateWindow: string | null
    error: string | null
  }>,
) {
  const now = new Date()
  const saved = []
  for (const hit of hits) {
    const [row] = await db
      .insert(csxShipmentSnapshots)
      .values({
        companyId,
        containerId: hit.containerId,
        containerNumberNormalized: normalizeContainerNumber(hit.equipmentNumber),
        terminalName: hit.terminal,
        equipmentNumber: hit.equipmentNumber,
        referenceUsed: SHIPCSX_REFERENCE,
        resultTab: hit.resultTab,
        loadEmpty: hit.loadEmpty,
        waybillDate: hit.waybillDate,
        inGateReadiness: hit.inGateReadiness,
        gateWindow: hit.gateWindow,
        error: hit.error,
        rawPayload: { ...hit },
        checkedAt: now,
      })
      .returning()
    if (row) saved.push(row)
  }
  return saved
}

export async function checkShipcsxForItems(
  db: Database,
  companyId: string,
  items: ShipcsxEligibleBox[],
) {
  const byTerminal = new Map<string, ShipcsxEligibleBox[]>()
  for (const item of items) {
    const list = byTerminal.get(item.terminal) ?? []
    list.push(item)
    byTerminal.set(item.terminal, list)
  }

  const saved = []
  for (const [terminal, batch] of byTerminal) {
    const hits = await lookupShipcsxShipments({
      terminal,
      items: batch.map(item => ({
        equipmentNumber: item.equipmentNumber,
        containerId: item.containerId,
      })),
    })
    saved.push(...await recordShipcsxHits(db, companyId, hits.map(hit => ({
      ...hit,
      terminal,
    }))))
  }
  return saved
}

export async function loadPollState(db: Database, companyId: string) {
  const [row] = await db.select().from(csxPollState).where(eq(csxPollState.companyId, companyId)).limit(1)
  return row ?? null
}

export async function recordPollOutcome(
  db: Database,
  companyId: string,
  input: { error?: string | null, checkedCount?: number, backoff?: boolean },
) {
  const now = new Date()
  const skipUntil = input.backoff ? new Date(now.getTime() + SHIPCSX_POLL_INTERVAL_MS) : null
  const [existing] = await db.select().from(csxPollState).where(eq(csxPollState.companyId, companyId)).limit(1)
  if (existing) {
    await db.update(csxPollState).set({
      lastFinishedAt: now,
      lastError: input.error ?? null,
      skipUntil,
      checkedCount: input.checkedCount ?? existing.checkedCount,
    }).where(eq(csxPollState.id, existing.id))
    return
  }
  await db.insert(csxPollState).values({
    companyId,
    lastStartedAt: now,
    lastFinishedAt: now,
    lastError: input.error ?? null,
    skipUntil,
    checkedCount: input.checkedCount ?? 0,
  })
}

export async function runShipcsxPoll(db: Database, now = new Date()) {
  if (!isShipcsxPollWindow(now)) {
    return { skipped: true, reason: 'outside-window', checked: 0 }
  }

  const companyRows = await db.select({ id: companies.id }).from(companies)
  let checked = 0

  for (const company of companyRows) {
    const state = await loadPollState(db, company.id)
    if (state?.skipUntil && state.skipUntil > now) {
      continue
    }
    const [existing] = await db.select().from(csxPollState).where(eq(csxPollState.companyId, company.id)).limit(1)
    if (existing) {
      await db.update(csxPollState).set({ lastStartedAt: now }).where(eq(csxPollState.id, existing.id))
    }
    else {
      await db.insert(csxPollState).values({ companyId: company.id, lastStartedAt: now })
    }

    try {
      const items = await listCustomerBoxesForShipcsx(db, company.id)
      const saved = await checkShipcsxForItems(db, company.id, items)
      checked += saved.length
      await recordPollOutcome(db, company.id, { checkedCount: saved.length, error: null })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : 'ShipCSX lookup failed.'
      const backoff = /challenged|blocked|captcha|sign in/i.test(message)
      await recordPollOutcome(db, company.id, { error: message, backoff })
    }
  }

  return { skipped: false, checked }
}

export async function shipcsxHealth(db: Database, companyId: string) {
  const state = await loadPollState(db, companyId)
  return {
    lastFinishedAt: state?.lastFinishedAt ?? null,
    lastError: state?.lastError ?? null,
    checkedCount: state?.checkedCount ?? 0,
  }
}
