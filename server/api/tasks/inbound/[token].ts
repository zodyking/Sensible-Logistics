import type { H3Event } from 'h3'
import { ingestInboundSms } from '../../../services/tasks'

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function pickPayload(body: unknown, query: Record<string, unknown>): { text: string, sender: string | null } {
  const bag: Record<string, unknown> = { ...query, ...asRecord(body) }
  let text = firstString(bag, ['text', 'body', 'message', 'sms', 'content', 'Body', 'Message']) ?? ''
  if (!text && typeof body === 'string') text = body.trim()
  const sender = firstString(bag, ['from', 'sender', 'fromNumber', 'From', 'phone', 'Phone'])
  return { text, sender }
}

function applyCors(event: H3Event) {
  setHeader(event, 'Access-Control-Allow-Origin', '*')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'Content-Type')
}

/**
 * Public SMS ingest. iPhone Shortcuts and Android automations POST here with
 * no session. The token in the path is the only credential.
 */
export default defineEventHandler(async (event) => {
  applyCors(event)

  if (event.method === 'OPTIONS') {
    return { ok: true }
  }

  const token = getRouterParam(event, 'token')
  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'Webhook token is required.' })
  }

  if (event.method === 'GET') {
    const query = getQuery(event) as Record<string, unknown>
    const text = firstString(query, ['text', 'body', 'message'])
    if (!text) {
      return {
        ok: true,
        service: 'sensible-tasks',
        hint: 'POST JSON { "text": "Work for tomorrow pickup at the yard", "from": "+15551212" }',
      }
    }
    return ingestInboundSms(useDb(), token, { text, sender: firstString(query, ['from', 'sender']) })
  }

  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Use POST or GET.' })
  }

  let body: unknown = null
  try {
    body = await readBody(event)
  }
  catch {
    // Empty or unreadable bodies are treated as query-only payloads.
  }

  const payload = pickPayload(body, getQuery(event) as Record<string, unknown>)
  return ingestInboundSms(useDb(), token, payload)
})
