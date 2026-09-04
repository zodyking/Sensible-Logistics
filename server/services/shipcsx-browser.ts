import {
  SHIPCSX_BATCH_SIZE,
  SHIPCSX_LOOKUP_URL,
  SHIPCSX_REFERENCE,
  chunkShipcsxEquipment,
  matchLookupCard,
  parseShipcsxLookupText,
  type CsxLookupCard,
} from '#shared/utils/csx-lookup'
import { normalizeContainerNumber } from '#shared/utils/iso6346'

export interface ShipcsxLookupItem {
  equipmentNumber: string
  containerId?: string | null
}

export interface ShipcsxLookupHit extends CsxLookupCard {
  containerId: string | null
  error: string | null
}

type PlaywrightModule = typeof import('playwright')

let queue: Promise<unknown> = Promise.resolve()
let playwrightModule: PlaywrightModule | null | undefined

const CHROMIUM_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
]

function config() {
  const runtime = useRuntimeConfig()
  const ship = (runtime as { shipcsx?: { defaultTerminal?: string } }).shipcsx
  return {
    defaultTerminal: ship?.defaultTerminal || process.env.NUXT_SHIPCSX_DEFAULT_TERMINAL || '',
  }
}

export async function withShipcsxLock<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.then(() => undefined, () => undefined)
  return run
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  if (playwrightModule) return playwrightModule
  if (playwrightModule === null) throw new Error('Playwright is not installed.')
  try {
    playwrightModule = await import('playwright')
    return playwrightModule
  }
  catch {
    playwrightModule = null
    throw new Error('Playwright is not installed. Run npx playwright install chromium.')
  }
}

function pause(min = 160, max = 420) {
  const ms = min + Math.floor(Math.random() * Math.max(1, max - min))
  return new Promise(resolveWait => setTimeout(resolveWait, ms))
}

const STEALTH = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
`

async function openPage() {
  const { chromium } = await loadPlaywright()
  const launched = await chromium.launch({
    headless: true,
    args: CHROMIUM_ARGS,
    chromiumSandbox: false,
  }).catch(async (first) => {
    const retry = await chromium.launch({
      headless: true,
      args: CHROMIUM_ARGS,
      channel: 'chrome',
    }).catch(() => null)
    if (retry) return retry
    const detail = first instanceof Error ? first.message : 'Chromium failed to launch'
    if (/executable|browser|chromium|playwright/i.test(detail)) {
      throw new Error('Playwright Chromium is not installed. The server image needs `npx playwright install chromium`.')
    }
    throw first instanceof Error ? first : new Error(detail)
  })

  const context = await launched.newContext({
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  })
  await context.addInitScript(STEALTH)
  const page = await context.newPage()
  return { browser: launched, context, page }
}

async function selectTerminal(page: import('playwright').Page, terminal: string) {
  const trigger = page.getByText('Select Terminal', { exact: false }).first()
    .or(page.locator('select, [role="combobox"]').first())
  await trigger.click({ timeout: 12_000 }).catch(() => undefined)
  await pause(200, 500)
  const option = page.getByRole('option', { name: terminal, exact: false }).first()
    .or(page.getByText(terminal, { exact: false }).first())
  if (await option.count()) {
    await option.click()
    await pause(250, 600)
    return
  }
  const typed = page.locator('input[placeholder*="Terminal"], input[aria-label*="Terminal"]').first()
  if (await typed.count()) {
    await typed.fill(terminal)
    await pause()
    await page.keyboard.press('Enter')
    await pause(250, 600)
  }
}

async function fillEquipmentRows(page: import('playwright').Page, equipment: string[]) {
  const equipInputs = page.locator('input[placeholder*="CSXU"], input[placeholder*="123456"], input[aria-label*="Equipment"]')
  const refInputs = page.locator('input[placeholder*="Pickup"], input[aria-label*="Reference"]')
  const equipCount = await equipInputs.count()
  const refCount = await refInputs.count()
  const n = Math.min(equipment.length, Math.max(equipCount, 3))

  if (equipCount === 0) {
    const all = page.locator('input[type="text"], input:not([type])')
    const total = await all.count()
    for (let i = 0; i < n && i * 2 + 1 < total; i++) {
      await all.nth(i * 2).fill(equipment[i] ?? '')
      await pause()
      await all.nth(i * 2 + 1).fill(SHIPCSX_REFERENCE)
      await pause()
    }
    return
  }

  for (let i = 0; i < n; i++) {
    await equipInputs.nth(Math.min(i, equipCount - 1)).fill(equipment[i] ?? '')
    await pause()
    if (refCount) {
      await refInputs.nth(Math.min(i, refCount - 1)).fill(SHIPCSX_REFERENCE)
      await pause()
    }
  }
}

async function runLookup(terminal: string, equipment: string[]): Promise<CsxLookupCard[]> {
  const { browser, context, page } = await openPage()
  try {
    await page.goto(SHIPCSX_LOOKUP_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await pause(400, 900)
    const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase()
    if (/unusual traffic|captcha|access denied|blocked/i.test(body)) {
      throw new Error('ShipCSX challenged this session. Backing off automatic checks.')
    }
    if (!page.url().includes('shipment/lookup') && /sign in|log in/.test(body) && /password/.test(body)) {
      throw new Error('ShipCSX shipment lookup is not available without a login wall.')
    }
    await selectTerminal(page, terminal)
    await fillEquipmentRows(page, equipment)
    const search = page.getByRole('button', { name: /search/i }).first()
      .or(page.locator('button:has-text("Search")').first())
    await search.click({ timeout: 12_000 })
    await page.waitForTimeout(1600)
    await page.getByText(/Shipment Lookup Results|In-Gate|NOTIFIED/i).first().waitFor({ timeout: 20_000 }).catch(() => undefined)
    const results = await page.locator('body').innerText()
    if (/unusual traffic|captcha|access denied|blocked/i.test(results)) {
      throw new Error('ShipCSX challenged this session. Backing off automatic checks.')
    }
    return parseShipcsxLookupText(results).cards
  }
  finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
}

export async function lookupShipcsxShipments(input: {
  terminal: string
  items: ShipcsxLookupItem[]
}): Promise<ShipcsxLookupHit[]> {
  const terminal = input.terminal.trim()
  if (!terminal) throw new Error('Set a ShipCSX terminal name on the rail location or NUXT_SHIPCSX_DEFAULT_TERMINAL.')
  const items = input.items.filter(item => normalizeContainerNumber(item.equipmentNumber))
  if (!items.length) return []

  return withShipcsxLock(async () => {
    const hits: ShipcsxLookupHit[] = []
    for (const batch of chunkShipcsxEquipment(items, SHIPCSX_BATCH_SIZE)) {
      const cards = await runLookup(terminal, batch.map(item => item.equipmentNumber))
      for (const item of batch) {
        const card = matchLookupCard(cards, item.equipmentNumber)
        hits.push({
          equipmentNumber: normalizeContainerNumber(item.equipmentNumber),
          containerId: item.containerId ?? null,
          loadEmpty: card?.loadEmpty ?? null,
          waybillDate: card?.waybillDate ?? null,
          inGateReadiness: card?.inGateReadiness ?? null,
          gateWindow: card?.gateWindow ?? null,
          resultTab: card?.resultTab ?? 'NOT_FOUND',
          error: card ? null : 'Not found on ShipCSX for this terminal.',
        })
      }
      await pause(500, 1100)
    }
    return hits
  })
}

export function defaultShipcsxTerminal(): string {
  return config().defaultTerminal
}
