import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
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

function config() {
  const runtime = useRuntimeConfig()
  const ship = (runtime as { shipcsx?: {
    profileDir?: string
    defaultTerminal?: string
    email?: string
    password?: string
  } }).shipcsx
  return {
    profileDir: ship?.profileDir || process.env.NUXT_SHIPCSX_PROFILE_DIR || resolve(process.cwd(), '.data/shipcsx-profile'),
    defaultTerminal: ship?.defaultTerminal || process.env.NUXT_SHIPCSX_DEFAULT_TERMINAL || '',
    email: ship?.email || process.env.NUXT_SHIPCSX_EMAIL || '',
    password: ship?.password || process.env.NUXT_SHIPCSX_PASSWORD || '',
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

async function openContext() {
  const { chromium } = await loadPlaywright()
  const { profileDir, email, password } = config()
  await mkdir(profileDir, { recursive: true })

  const launched = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  }).catch(async () => chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    args: ['--disable-blink-features=AutomationControlled'],
  }))

  await launched.addInitScript(STEALTH)
  const page = launched.pages()[0] ?? await launched.newPage()
  return { context: launched, page, email, password }
}

async function maybeSignIn(page: import('playwright').Page, email: string, password: string) {
  const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase()
  const loginish = /sign in|log in|password/.test(body)
  if (!loginish) return
  if (!email || !password) {
    throw new Error('ShipCSX needs a signed-in profile. Set NUXT_SHIPCSX_EMAIL and NUXT_SHIPCSX_PASSWORD, or sign in once on this server profile.')
  }
  const emailBox = page.locator('input[type="email"], input[name="username"], input[name="email"]').first()
  const passBox = page.locator('input[type="password"]').first()
  if (await emailBox.count()) {
    await emailBox.fill(email)
    await pause()
  }
  if (await passBox.count()) {
    await passBox.fill(password)
    await pause()
    await page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")').first().click()
    await page.waitForTimeout(1800)
  }
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
  const { context, page, email, password } = await openContext()
  try {
    await page.goto(SHIPCSX_LOOKUP_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await pause(400, 900)
    await maybeSignIn(page, email, password)
    if (!page.url().includes('shipment/lookup')) {
      await page.goto(SHIPCSX_LOOKUP_URL, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await pause(400, 800)
    }
    await selectTerminal(page, terminal)
    await fillEquipmentRows(page, equipment)
    const search = page.getByRole('button', { name: /search/i }).first()
      .or(page.locator('button:has-text("Search")').first())
    await search.click({ timeout: 12_000 })
    await page.waitForTimeout(1600)
    await page.getByText(/Shipment Lookup Results|In-Gate|NOTIFIED/i).first().waitFor({ timeout: 20_000 }).catch(() => undefined)
    const body = await page.locator('body').innerText()
    if (/unusual traffic|captcha|access denied|blocked/i.test(body)) {
      throw new Error('ShipCSX challenged this session. Backing off automatic checks.')
    }
    if (/sign in|log in/i.test(body) && /password/i.test(body)) {
      throw new Error('ShipCSX needs a signed-in profile. Sign in once on this server profile.')
    }
    return parseShipcsxLookupText(body).cards
  }
  finally {
    await context.close().catch(() => undefined)
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
