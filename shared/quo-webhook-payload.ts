import { phonesEqual } from './utils/phone'

/**
 * Normalize Quo / OpenPhone message.received webhook payloads.
 * Supports both the 2026-03-30 shape (`data.resource` + `data.context`)
 * and older `data.object` payloads.
 */

export interface ParsedQuoInboundMessage {
  messageId: string | null
  direction: string | null
  fromPhone: string | null
  toPhone: string | null
  body: string
  rawType: string | null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function firstString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return String(candidate)
  }
  return null
}

function firstPhoneFromUnknown(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return firstString(value)
  if (Array.isArray(value)) {
    for (const item of value) {
      const phone = firstPhoneFromUnknown(item)
      if (phone) return phone
    }
  }
  const row = asRecord(value)
  if (!row) return null
  return firstString(
    row.phoneNumber,
    row.number,
    row.e164,
    row.identifier,
    row.value,
  )
}

/** Extract inbound SMS fields from a Quo webhook JSON body. */
export function parseQuoMessageReceivedPayload(payload: unknown): ParsedQuoInboundMessage {
  const root = asRecord(payload) ?? {}
  const rawType = firstString(root.type, root.event)
  const data = asRecord(root.data) ?? root

  const resource = asRecord(data.resource)
  const context = asRecord(data.context)
  const object = asRecord(data.object) ?? (resource ? null : data)

  const direction = firstString(
    resource?.direction,
    object?.direction,
    data.direction,
  )?.toLowerCase() ?? null

  const body = firstString(
    resource?.text,
    resource?.body,
    resource?.content,
    object?.text,
    object?.body,
    object?.content,
    data.text,
    data.body,
    data.content,
  ) ?? ''

  const fromPhone = firstPhoneFromUnknown(
    context?.senderIdentifier
    ?? object?.from
    ?? object?.fromPhoneNumber
    ?? data.from
    ?? data.fromPhoneNumber
    ?? resource?.from,
  )

  const toPhone = firstPhoneFromUnknown(
    context?.recipientIdentifiers
    ?? object?.to
    ?? object?.toPhoneNumber
    ?? data.to
    ?? data.toPhoneNumber
    ?? resource?.to,
  )

  const messageId = firstString(
    resource?.id,
    object?.id,
    data.id,
    root.id,
  )

  return {
    messageId,
    direction,
    fromPhone,
    toPhone,
    body,
    rawType,
  }
}

export function isQuoInboundDirection(direction: string | null | undefined): boolean {
  if (!direction) return true
  return direction === 'incoming' || direction === 'inbound'
}

/** Pull a 6-digit verification code out of an inbound SMS body. */
export function extractSmsCode(body: string): string | null {
  const match = String(body ?? '').match(/\b(\d{6})\b/)
  return match?.[1] ?? null
}

export type QuoInboundIgnoreReason = 'wrong_type' | 'not_inbound' | 'wrong_number' | 'self_message'

/**
 * Only SMS to the selected platform number is processed. Other Quo numbers,
 * outbound traffic, and echoes from the platform number itself are ignored.
 */
export function evaluateQuoInboundMessage(
  parsed: ParsedQuoInboundMessage,
  platformNumber: string | null | undefined,
): { ignore: true, reason: QuoInboundIgnoreReason } | { ignore: false } {
  if (parsed.rawType && parsed.rawType !== 'message.received') {
    return { ignore: true, reason: 'wrong_type' }
  }
  if (!isQuoInboundDirection(parsed.direction)) {
    return { ignore: true, reason: 'not_inbound' }
  }
  if (!platformNumber || !parsed.toPhone || !phonesEqual(platformNumber, parsed.toPhone)) {
    return { ignore: true, reason: 'wrong_number' }
  }
  if (parsed.fromPhone && phonesEqual(platformNumber, parsed.fromPhone)) {
    return { ignore: true, reason: 'self_message' }
  }
  return { ignore: false }
}
