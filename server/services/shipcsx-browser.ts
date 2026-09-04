import {
  SHIPCSX_BATCH_SIZE,
  SHIPCSX_LOOKUP_URL,
  SHIPCSX_REFERENCE,
  chunkShipcsxEquipment,
  matchLookupCard,
  matchShipcsxTerminalOption,
  parseShipcsxLookupText,
  shipcsxEquipmentParts,
  shipcsxPageLooksHardBlocked,
  shipcsxPageLooksLikeChallenge,
  shipcsxPageLooksLikeLogin,
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
type Page = import('playwright').Page
type Locator = import('playwright').Locator

let queue: Promise<unknown> = Promise.resolve()
let playwrightModule: PlaywrightModule | null | undefined

const CHROMIUM_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
]

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

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
    viewport: { width: 1280, height: 900 },
    userAgent: DESKTOP_UA,
  })
  await context.addInitScript(STEALTH)
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  return { browser: launched, context, page }
}

async function bodyText(page: Page): Promise<string> {
  return page.locator('body').innerText().catch(() => '')
}

function assertLookupPage(text: string, url: string) {
  if (shipcsxPageLooksHardBlocked(text)) {
    throw new Error('ShipCSX challenged this session. Backing off automatic checks.')
  }
  if (shipcsxPageLooksLikeLogin(text, url)) {
    throw new Error('ShipCSX shipment lookup is not available without a login wall.')
  }
}

async function waitForLookupForm(page: Page) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const text = await bodyText(page)
    const url = page.url()
    if (shipcsxPageLooksHardBlocked(text)) {
      throw new Error('ShipCSX challenged this session. Backing off automatic checks.')
    }
    if (shipcsxPageLooksLikeLogin(text, url)) {
      throw new Error('ShipCSX shipment lookup is not available without a login wall.')
    }
    const form = page.locator('ion-input, ion-select, input, select, [role="combobox"]').first()
    const search = searchButton(page)
    if (await form.count() || await search.count()) {
      if (await form.first().isVisible().catch(() => false) || await search.isVisible().catch(() => false)) {
        return
      }
    }
    await pause(400, 800)
  }
  const leftover = await bodyText(page)
  if (shipcsxPageLooksLikeChallenge(leftover) || shipcsxPageLooksHardBlocked(leftover)) {
    throw new Error('ShipCSX challenged this session. Backing off automatic checks.')
  }
  throw new Error('ShipCSX lookup form did not load. The search button never became available.')
}

function searchButton(page: Page): Locator {
  return page.getByRole('button', { name: /search/i }).first()
    .or(page.locator('ion-button').filter({ hasText: /search/i }).first())
    .or(page.locator('button, [type="submit"]').filter({ hasText: /search/i }).first())
}

async function fillControl(locator: Locator, value: string) {
  const handle = locator.first()
  await handle.waitFor({ state: 'attached', timeout: 15_000 })
  const inner = handle.locator('input').first()
  const target = (await inner.count()) ? inner : handle
  await target.click({ timeout: 8_000 })
  await target.fill('')
  await target.pressSequentially(value, { delay: 12 })
  await target.evaluate((el, next) => {
    const host = el as HTMLElement
    const input = (host instanceof HTMLInputElement
      ? host
      : host.querySelector?.('input') || host.shadowRoot?.querySelector('input')) as HTMLInputElement | null
    if (!input) return
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    descriptor?.set?.call(input, next)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await target.blur().catch(() => undefined)
}

async function nativeTerminalSelect(page: Page): Promise<Locator | null> {
  const selects = page.locator('select')
  const n = await selects.count()
  if (!n) return null
  let bestIndex = 0
  let bestOptions = 0
  for (let i = 0; i < n; i++) {
    const options = await selects.nth(i).locator('option').count()
    if (options > bestOptions) {
      bestIndex = i
      bestOptions = options
    }
  }
  return bestOptions >= 2 ? selects.nth(bestIndex) : selects.first()
}

async function selectTerminal(page: Page, terminal: string) {
  const native = await nativeTerminalSelect(page)
  if (native) {
    const labels = await native.locator('option').allTextContents()
    const match = matchShipcsxTerminalOption(labels, terminal)
    if (!match) {
      throw new Error(`ShipCSX terminal "${terminal}" was not in the dropdown.`)
    }
    await native.selectOption({ label: match })
    await pause(250, 500)
    return
  }

  const trigger = page.locator('ion-select').first()
    .or(page.getByRole('combobox').first())
    .or(page.getByText(/select terminal/i).first())
  if (!(await trigger.count())) {
    throw new Error(`Could not select ShipCSX terminal "${terminal}".`)
  }
  await trigger.click({ timeout: 15_000 })
  await pause(200, 450)

  const option = page.getByRole('radio', { name: new RegExp(terminal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first()
    .or(page.getByRole('option', { name: terminal, exact: false }).first())
    .or(page.getByText(terminal, { exact: false }).first())
  if (!(await option.count())) {
    throw new Error(`ShipCSX terminal "${terminal}" was not in the dropdown.`)
  }
  await option.click({ timeout: 10_000 })
  await pause(150, 350)
  const done = page.getByRole('button', { name: /^(ok|done)$/i }).first()
  if (await done.count()) await done.click().catch(() => undefined)
  await pause(250, 500)

  const shown = (await bodyText(page)).toLowerCase()
  const token = terminal.trim().toLowerCase().slice(0, 8)
  if (token && !shown.includes(token)) {
    throw new Error(`Could not select ShipCSX terminal "${terminal}".`)
  }
}

async function fillEquipmentRows(page: Page, equipment: string[]) {
  const rows = equipment
    .map(shipcsxEquipmentParts)
    .filter((parts): parts is NonNullable<typeof parts> => Boolean(parts))
  if (!rows.length) return

  const initials = page.locator(
    'input[placeholder*="CSXU" i], input[aria-label*="Initial" i], ion-input[placeholder*="CSXU" i], ion-input[label*="Initial" i]',
  )
  const numbers = page.locator(
    'input[placeholder*="123456"], input[aria-label*="Equipment Number" i], ion-input[placeholder*="123456"], ion-input[label*="Number" i]',
  )
  const refs = page.locator(
    'input[placeholder*="Pickup" i], input[aria-label*="Reference" i], ion-input[placeholder*="Pickup" i], ion-input[label*="Reference" i]',
  )

  const labeledInitial = page.getByLabel(/equipment initial|initial/i)
  const labeledNumber = page.getByLabel(/equipment number/i)

  if (await initials.count()) {
    const initialCount = await initials.count()
    const numberCount = await numbers.count()
    const refCount = await refs.count()
    for (const [i, row] of rows.entries()) {
      const initialField = initials.nth(Math.min(i, initialCount - 1))
      if (numberCount) {
        await fillControl(initialField, row.initial)
        await pause()
        await fillControl(numbers.nth(Math.min(i, numberCount - 1)), row.number)
        await pause()
      }
      else {
        await fillControl(initialField, `${row.initial}${row.number}`)
        await pause()
      }
      if (refCount) {
        await fillControl(refs.nth(Math.min(i, refCount - 1)), SHIPCSX_REFERENCE)
        await pause()
      }
    }
    return
  }

  if (await labeledInitial.count() && await labeledNumber.count()) {
    const initialCount = await labeledInitial.count()
    const numberCount = await labeledNumber.count()
    for (const [i, row] of rows.entries()) {
      await fillControl(labeledInitial.nth(Math.min(i, initialCount - 1)), row.initial)
      await pause()
      await fillControl(labeledNumber.nth(Math.min(i, numberCount - 1)), row.number)
      await pause()
    }
    return
  }

  const all = page.locator('input[type="text"], input:not([type]), ion-input')
  const total = await all.count()
  for (const [i, row] of rows.entries()) {
    const base = i * 3
    if (base >= total) break
    await fillControl(all.nth(base), row.initial)
    await pause()
    if (base + 1 < total) {
      await fillControl(all.nth(base + 1), row.number)
      await pause()
    }
    if (base + 2 < total) {
      await fillControl(all.nth(base + 2), SHIPCSX_REFERENCE)
      await pause()
    }
  }
}

async function submitSearch(page: Page) {
  const search = searchButton(page)
  if (await search.count()) {
    const enabled = await search.isEnabled({ timeout: 0 }).catch(() => false)
    if (enabled) {
      await search.click({ timeout: 15_000 })
      return
    }
    await search.click({ force: true, timeout: 8_000 }).catch(() => undefined)
  }
  await page.keyboard.press('Enter')
}

async function runLookup(terminal: string, equipment: string[]): Promise<CsxLookupCard[]> {
  const { browser, context, page } = await openPage()
  try {
    console.info('[shipcsx] lookup', { terminal, count: equipment.length })
    await page.goto(SHIPCSX_LOOKUP_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await waitForLookupForm(page)
    assertLookupPage(await bodyText(page), page.url())
    await selectTerminal(page, terminal)
    await fillEquipmentRows(page, equipment)
    await submitSearch(page)
    await page.waitForTimeout(1200)
    const resultsHeading = page.getByText(/Shipment Lookup Results|In-Gate|NOTIFIED/i).first()
    const appeared = await resultsHeading.waitFor({ timeout: 25_000 }).then(() => true).catch(() => false)
    const results = await bodyText(page)
    assertLookupPage(results, page.url())
    if (!appeared && /select terminal|equipment initial|equipment lookup/i.test(results)) {
      console.warn('[shipcsx] search did not return results', { url: page.url(), snippet: results.slice(0, 280) })
      throw new Error('ShipCSX did not return lookup results. Search may still be disabled.')
    }
    return parseShipcsxLookupText(results).cards
  }
  catch (error) {
    if (error instanceof Error && /locator\.|timeout \d+ms exceeded|getByRole/i.test(error.message)) {
      console.warn('[shipcsx] playwright', error.message.split('\n')[0])
      throw new Error('ShipCSX did not return lookup results. Search may still be disabled.', { cause: error })
    }
    throw error
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
