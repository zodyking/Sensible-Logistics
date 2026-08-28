import { eq } from 'drizzle-orm'
import { phonesEqual, toE164 } from '#shared/utils/phone'
import { verifyQuoWebhookSignature } from '../../shared/quo-webhook-signature'
import { companies } from '../database/schema'
import type { Company } from '../database/schema'
import type { DbExecutor } from '../utils/db'
import { appBaseUrl } from './mail'
import { openSecret, sealSecret } from '../utils/secret-box'
import { ensurePrimaryCompany } from '../utils/company'

export { verifyQuoWebhookSignature }

export const QUO_API_BASE = 'https://api.quo.com'
export const QUO_API_VERSION = '2026-03-30'
export const QUO_FETCH_TIMEOUT_MS = 8_000

export interface QuoConfig {
  enabled: boolean
  apiKey: string
  fromNumber: string
  webhookId: string
  webhookKey: string
  webhookUrl: string
}

interface QuoStored {
  enabled?: boolean
  fromNumber?: string
  webhookId?: string
  webhookUrl?: string
  apiKeyEnc?: string
  webhookKeyEnc?: string
}

const EMPTY: QuoConfig = {
  enabled: false,
  apiKey: '',
  fromNumber: '',
  webhookId: '',
  webhookKey: '',
  webhookUrl: '',
}

export class QuoApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'QuoApiError'
  }
}

export interface QuoPhoneNumber {
  id: string
  number: string
  formattedNumber?: string | null
  name?: string | null
}

export interface QuoSettingsView {
  enabled: boolean
  hasApiKey: boolean
  fromNumber: string | null
  configured: boolean
  webhookConfigured: boolean
  webhookUrl: string | null
}

function fromSettings(company: Company): QuoConfig {
  const stored = (company.settings?.quo ?? null) as QuoStored | null
  if (!stored) return { ...EMPTY }
  const apiKey = stored.apiKeyEnc ? openSecret(stored.apiKeyEnc) : ''
  const webhookKey = stored.webhookKeyEnc ? openSecret(stored.webhookKeyEnc) : ''
  const fromNumber = stored.fromNumber ? (toE164(stored.fromNumber) || stored.fromNumber.trim()) : ''
  const enabled = Boolean(stored.enabled) && Boolean(apiKey) && Boolean(fromNumber)
  return {
    enabled,
    apiKey,
    fromNumber,
    webhookId: stored.webhookId?.trim() || '',
    webhookKey,
    webhookUrl: stored.webhookUrl?.trim() || '',
  }
}

function toView(config: QuoConfig): QuoSettingsView {
  const hasApiKey = Boolean(config.apiKey.trim())
  const fromNumber = config.fromNumber ? (toE164(config.fromNumber) || config.fromNumber) : null
  return {
    enabled: Boolean(config.enabled) && hasApiKey && Boolean(fromNumber),
    hasApiKey,
    fromNumber,
    configured: hasApiKey && Boolean(fromNumber),
    webhookConfigured: Boolean(config.webhookId && config.webhookKey),
    webhookUrl: config.webhookUrl || null,
  }
}

export function isQuoEnabled(config: QuoConfig | QuoSettingsView | null | undefined): boolean {
  if (!config) return false
  if ('configured' in config) return Boolean(config.enabled && config.configured)
  return Boolean(config.enabled && config.apiKey?.trim() && config.fromNumber?.trim())
}

export async function loadQuoCompany(db: DbExecutor, companyId?: string): Promise<Company> {
  if (companyId) {
    const [row] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1)
    if (row) return row
  }
  return ensurePrimaryCompany(db)
}

export async function getQuoConfig(db: DbExecutor, companyId?: string): Promise<QuoConfig> {
  const company = await loadQuoCompany(db, companyId)
  return fromSettings(company)
}

export async function getQuoSettingsView(db: DbExecutor, companyId?: string): Promise<QuoSettingsView> {
  return toView(await getQuoConfig(db, companyId))
}

export async function saveQuoSettings(
  db: DbExecutor,
  companyId: string,
  patch: { enabled?: boolean, apiKey?: string, fromNumber?: string },
): Promise<QuoSettingsView> {
  const company = await loadQuoCompany(db, companyId)
  const current = fromSettings(company)
  const next: QuoConfig = {
    ...current,
    enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
    apiKey: patch.apiKey !== undefined ? patch.apiKey.trim() : current.apiKey,
    fromNumber: patch.fromNumber !== undefined
      ? (toE164(patch.fromNumber) || patch.fromNumber.trim())
      : current.fromNumber,
  }
  if (next.enabled && (!next.apiKey || !next.fromNumber)) next.enabled = false
  await persistQuoConfig(db, company, next)
  if (next.enabled && next.apiKey && next.fromNumber) {
    try {
      await ensureQuoInboundWebhook(db, company.id)
    }
    catch (error) {
      console.warn('[quo] inbound webhook ensure failed:', error instanceof Error ? error.message : error)
    }
  }
  return getQuoSettingsView(db, company.id)
}

async function persistQuoConfig(db: DbExecutor, company: Company, next: QuoConfig) {
  const stored: QuoStored = {
    enabled: next.enabled,
    fromNumber: next.fromNumber,
    webhookId: next.webhookId,
    webhookUrl: next.webhookUrl,
    apiKeyEnc: next.apiKey ? sealSecret(next.apiKey) : '',
    webhookKeyEnc: next.webhookKey ? sealSecret(next.webhookKey) : '',
  }
  await db
    .update(companies)
    .set({
      settings: { ...company.settings, quo: stored },
      updatedAt: new Date(),
    })
    .where(eq(companies.id, company.id))
}

export async function quoFetch<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {},
  opts: { apiVersion?: string } = {},
): Promise<T> {
  const res = await fetch(`${QUO_API_BASE}${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(QUO_FETCH_TIMEOUT_MS),
    headers: {
      Authorization: apiKey,
      Accept: 'application/json',
      ...(opts.apiVersion ? { 'Quo-Api-Version': opts.apiVersion } : {}),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  const text = await res.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : null
  }
  catch {
    parsed = { message: text }
  }
  if (!res.ok) {
    const msg = typeof parsed === 'object' && parsed && 'message' in parsed
      ? String((parsed as { message: unknown }).message)
      : `Quo API error (${res.status})`
    throw new QuoApiError(res.status, msg)
  }
  return parsed as T
}

export async function listQuoPhoneNumbers(apiKey: string): Promise<QuoPhoneNumber[]> {
  const res = await quoFetch<{ data?: Array<Record<string, unknown>> }>(apiKey, '/v1/phone-numbers')
  const rows = Array.isArray(res?.data) ? res.data : []
  return rows.map((row) => {
    const number = String(row.number ?? row.phoneNumber ?? '')
    return {
      id: String(row.id ?? ''),
      number,
      formattedNumber: row.formattedNumber != null ? String(row.formattedNumber) : null,
      name: row.name != null ? String(row.name) : null,
    }
  }).filter(row => row.id || row.number)
}

export async function sendQuoSms(input: {
  apiKey: string
  from: string
  to: string
  content: string
}): Promise<{ id: string | null }> {
  const to = toE164(input.to)
  const from = toE164(input.from) || input.from.trim()
  if (!to) throw new QuoApiError(400, 'Invalid destination phone number')
  if (!from) throw new QuoApiError(400, 'Quo from number is not configured')
  const content = input.content.trim()
  if (!content) throw new QuoApiError(400, 'SMS body is empty')

  const res = await quoFetch<{ data?: { id?: string }, id?: string }>(input.apiKey, '/v1/messages', {
    method: 'POST',
    body: JSON.stringify({
      content: content.slice(0, 1600),
      from,
      to: [to],
    }),
  })
  return { id: res?.data?.id ?? res?.id ?? null }
}

async function deleteQuoWebhook(apiKey: string, webhookId: string) {
  if (!webhookId) return
  try {
    await quoFetch(apiKey, `/webhooks/${webhookId}`, { method: 'DELETE' }, { apiVersion: QUO_API_VERSION })
  }
  catch (error) {
    console.warn('[quo] failed to delete webhook:', webhookId, error instanceof Error ? error.message : error)
  }
}

export async function ensureQuoInboundWebhook(db: DbExecutor, companyId: string, opts: { force?: boolean } = {}): Promise<QuoSettingsView> {
  const company = await loadQuoCompany(db, companyId)
  const config = fromSettings(company)
  if (!config.apiKey.trim()) throw new QuoApiError(400, 'Quo API key is not saved')

  const webhookUrl = `${appBaseUrl()}/api/webhooks/quo`
  if (!opts.force && config.webhookId && config.webhookKey && config.webhookUrl === webhookUrl) {
    return toView(config)
  }

  if (config.webhookId) await deleteQuoWebhook(config.apiKey, config.webhookId)

  const body = {
    url: webhookUrl,
    events: ['message.received'],
    resourceIds: ['*'],
    status: 'enabled',
    label: 'Sensible Logistics phone verification',
  }

  let created: { data?: { id?: string, key?: string } }
  try {
    created = await quoFetch(config.apiKey, '/webhooks', {
      method: 'POST',
      body: JSON.stringify(body),
    }, { apiVersion: QUO_API_VERSION })
  }
  catch (error) {
    console.warn('[quo] webhook create failed, trying list/replace:', error instanceof Error ? error.message : error)
    const listed = await quoFetch<{ data?: Array<{ id?: string, url?: string }> }>(
      config.apiKey,
      '/webhooks',
      {},
      { apiVersion: QUO_API_VERSION },
    )
    for (const row of listed?.data ?? []) {
      if (String(row.url ?? '').replace(/\/$/, '') === webhookUrl.replace(/\/$/, '') && row.id) {
        await deleteQuoWebhook(config.apiKey, String(row.id))
      }
    }
    created = await quoFetch(config.apiKey, '/webhooks', {
      method: 'POST',
      body: JSON.stringify(body),
    }, { apiVersion: QUO_API_VERSION })
  }

  const id = String(created?.data?.id ?? '').trim()
  const key = String(created?.data?.key ?? '').trim()
  if (!id || !key) throw new QuoApiError(502, 'Quo webhook create response missing id/key')

  await persistQuoConfig(db, company, { ...config, webhookId: id, webhookKey: key, webhookUrl })
  return toView({ ...config, webhookId: id, webhookKey: key, webhookUrl })
}

export function isPlatformNumber(config: QuoConfig, phone: string | null | undefined): boolean {
  return phonesEqual(config.fromNumber, phone)
}

export async function testQuoConnection(
  db: DbExecutor,
  companyId: string,
  apiKeyOverride?: string,
): Promise<{ ok: boolean, message: string, phoneNumbers: QuoPhoneNumber[], fromNumber: string | null }> {
  const config = await getQuoConfig(db, companyId)
  const apiKey = apiKeyOverride?.trim() || config.apiKey
  const fromNumber = config.fromNumber ? (toE164(config.fromNumber) || config.fromNumber) : null
  if (!apiKey) {
    return { ok: false, message: 'API key is not saved', phoneNumbers: [], fromNumber }
  }
  try {
    const phoneNumbers = await listQuoPhoneNumbers(apiKey)
    return {
      ok: true,
      phoneNumbers,
      fromNumber,
      message: phoneNumbers.length
        ? `Connected — ${phoneNumbers.length} Quo number${phoneNumbers.length === 1 ? '' : 's'} found`
        : 'Connected — no phone numbers on this workspace yet',
    }
  }
  catch (error) {
    return {
      ok: false,
      phoneNumbers: [],
      fromNumber,
      message: error instanceof Error ? error.message : 'Quo connection failed',
    }
  }
}
