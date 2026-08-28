import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import type { DbExecutor } from '../utils/db'
import { phoneChallenges } from '../database/schema'
import { isValidPhone, toE164 } from '../../shared/utils/phone'
import { extractSmsCode } from '../../shared/quo-webhook-payload'
import {
  getQuoConfig,
  isPlatformNumber,
  isQuoEnabled,
  QuoApiError,
  sendQuoSms,
} from './quo'

export type PhoneChallengePurpose = 'SIGNUP' | 'CHANGE'

const CODE_TTL_MS = 10 * 60 * 1000
const TICKET_TTL_MS = 30 * 60 * 1000
const MAX_SENDS_PER_WINDOW = 3
const SEND_WINDOW_MS = 15 * 60 * 1000
const MAX_CONFIRM_ATTEMPTS = 5

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function generateTicket() {
  return randomBytes(24).toString('base64url')
}

export async function isPhoneVerificationRequired(db: DbExecutor, companyId?: string | null) {
  const config = await getQuoConfig(db, companyId ?? undefined)
  return isQuoEnabled(config)
}

export async function requestPhoneChallenge(db: DbExecutor, input: {
  companyId: string
  userId?: string | null
  purpose: PhoneChallengePurpose
  mobileNumber: string
}) {
  if (!isValidPhone(input.mobileNumber)) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a valid 10-digit mobile number.' })
  }

  const config = await getQuoConfig(db, input.companyId)
  if (!isQuoEnabled(config)) {
    throw createError({ statusCode: 400, statusMessage: 'Phone verification is not enabled.' })
  }

  const phoneE164 = toE164(input.mobileNumber)
  const windowStart = new Date(Date.now() - SEND_WINDOW_MS)
  const recent = await db
    .select({ id: phoneChallenges.id })
    .from(phoneChallenges)
    .where(and(
      eq(phoneChallenges.companyId, input.companyId),
      eq(phoneChallenges.phoneE164, phoneE164),
      eq(phoneChallenges.purpose, input.purpose),
      gt(phoneChallenges.createdAt, windowStart),
    ))

  if (recent.length >= MAX_SENDS_PER_WINDOW) {
    throw createError({
      statusCode: 429,
      statusMessage: 'Too many codes sent. Wait a few minutes and try again.',
    })
  }

  const code = generateCode()
  const expiresAt = new Date(Date.now() + CODE_TTL_MS)
  const [row] = await db.insert(phoneChallenges).values({
    companyId: input.companyId,
    userId: input.userId ?? null,
    purpose: input.purpose,
    phoneE164,
    codeHash: hashValue(code),
    expiresAt,
  }).returning()

  if (!row) {
    throw createError({ statusCode: 500, statusMessage: 'Could not create the verification challenge.' })
  }

  try {
    await sendQuoSms({
      apiKey: config.apiKey,
      from: config.fromNumber,
      to: phoneE164,
      content: `Sensible Logistics code: ${code}. Reply with this code to verify.`,
    })
  }
  catch (error) {
    await db.delete(phoneChallenges).where(eq(phoneChallenges.id, row.id))
    throw createError({
      statusCode: error instanceof QuoApiError ? 502 : 500,
      statusMessage: error instanceof Error ? error.message : 'Could not send the verification text.',
    })
  }

  return { challengeId: row.id, expiresAt }
}

async function latestOpenChallenge(db: DbExecutor, input: {
  companyId: string
  purpose: PhoneChallengePurpose
  phoneE164: string
}) {
  const [challenge] = await db
    .select()
    .from(phoneChallenges)
    .where(and(
      eq(phoneChallenges.companyId, input.companyId),
      eq(phoneChallenges.phoneE164, input.phoneE164),
      eq(phoneChallenges.purpose, input.purpose),
      isNull(phoneChallenges.consumedAt),
    ))
    .orderBy(desc(phoneChallenges.createdAt))
    .limit(1)
  return challenge ?? null
}

async function mintTicket(db: DbExecutor, challengeId: string) {
  const ticket = generateTicket()
  const ticketExpires = new Date(Date.now() + TICKET_TTL_MS)
  await db.update(phoneChallenges).set({
    ticketHash: hashValue(ticket),
    expiresAt: ticketExpires,
  }).where(eq(phoneChallenges.id, challengeId))
  return { ticket, expiresAt: ticketExpires }
}

export async function confirmPhoneChallenge(db: DbExecutor, input: {
  companyId: string
  purpose: PhoneChallengePurpose
  mobileNumber: string
  code: string
}) {
  if (!isValidPhone(input.mobileNumber)) {
    throw createError({ statusCode: 400, statusMessage: 'Enter a valid 10-digit mobile number.' })
  }
  const code = input.code.replace(/\D/g, '')
  if (!/^\d{6}$/.test(code)) {
    throw createError({ statusCode: 400, statusMessage: 'Enter the 6-digit code we texted you.' })
  }

  const phoneE164 = toE164(input.mobileNumber)
  const challenge = await latestOpenChallenge(db, {
    companyId: input.companyId,
    purpose: input.purpose,
    phoneE164,
  })

  if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
    throw createError({ statusCode: 400, statusMessage: 'That code expired. Send a new one.' })
  }
  if (challenge.attemptCount >= MAX_CONFIRM_ATTEMPTS) {
    throw createError({ statusCode: 429, statusMessage: 'Too many attempts. Send a new code.' })
  }

  if (challenge.codeHash !== hashValue(code)) {
    await db.update(phoneChallenges)
      .set({ attemptCount: challenge.attemptCount + 1 })
      .where(eq(phoneChallenges.id, challenge.id))
    throw createError({ statusCode: 400, statusMessage: 'That code did not match.' })
  }

  await db.update(phoneChallenges).set({
    verifiedAt: new Date(),
    attemptCount: challenge.attemptCount,
  }).where(eq(phoneChallenges.id, challenge.id))

  const issued = await mintTicket(db, challenge.id)
  return issued
}

export async function issueTicketIfVerified(db: DbExecutor, input: {
  companyId: string
  purpose: PhoneChallengePurpose
  mobileNumber: string
}) {
  if (!isValidPhone(input.mobileNumber)) {
    return { verified: false as const }
  }

  const challenge = await latestOpenChallenge(db, {
    companyId: input.companyId,
    purpose: input.purpose,
    phoneE164: toE164(input.mobileNumber),
  })

  if (!challenge?.verifiedAt || challenge.expiresAt.getTime() < Date.now()) {
    return { verified: false as const }
  }

  const issued = await mintTicket(db, challenge.id)
  return { verified: true as const, ...issued }
}

export async function consumePhoneTicket(db: DbExecutor, input: {
  companyId: string
  purpose: PhoneChallengePurpose
  mobileNumber: string
  ticket: string
  userId?: string | null
}) {
  if (!(await isPhoneVerificationRequired(db, input.companyId))) {
    return { verified: false as const }
  }

  const phoneE164 = isValidPhone(input.mobileNumber) ? toE164(input.mobileNumber) : ''
  const ticket = input.ticket?.trim() || ''
  if (!phoneE164 || !ticket) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Verify this mobile number before continuing.',
    })
  }

  const [challenge] = await db
    .select()
    .from(phoneChallenges)
    .where(and(
      eq(phoneChallenges.companyId, input.companyId),
      eq(phoneChallenges.phoneE164, phoneE164),
      eq(phoneChallenges.purpose, input.purpose),
      eq(phoneChallenges.ticketHash, hashValue(ticket)),
      isNull(phoneChallenges.consumedAt),
    ))
    .limit(1)

  if (!challenge?.verifiedAt || challenge.expiresAt.getTime() < Date.now()) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Verify this mobile number before continuing.',
    })
  }

  await db.update(phoneChallenges).set({
    consumedAt: new Date(),
    userId: input.userId ?? challenge.userId,
  }).where(eq(phoneChallenges.id, challenge.id))

  return { verified: true as const, phoneE164 }
}

export async function markChallengeVerifiedByInboundCode(db: DbExecutor, input: {
  companyId: string
  phoneE164: string
  code: string
}) {
  const code = input.code.replace(/\D/g, '')
  if (!/^\d{6}$/.test(code)) return false

  const rows = await db
    .select()
    .from(phoneChallenges)
    .where(and(
      eq(phoneChallenges.companyId, input.companyId),
      eq(phoneChallenges.phoneE164, input.phoneE164),
      isNull(phoneChallenges.consumedAt),
    ))
    .orderBy(desc(phoneChallenges.createdAt))
    .limit(8)

  const now = Date.now()
  const match = rows.find(row => row.codeHash === hashValue(code) && row.expiresAt.getTime() >= now)
  if (!match) return false

  await db.update(phoneChallenges).set({
    verifiedAt: new Date(),
  }).where(eq(phoneChallenges.id, match.id))
  return true
}

export async function handleInboundPhoneCode(db: DbExecutor, input: {
  companyId: string
  fromE164: string
  toE164: string
  text: string
}) {
  const config = await getQuoConfig(db, input.companyId)
  if (!isQuoEnabled(config) || !isPlatformNumber(config, input.toE164)) return false
  if (isPlatformNumber(config, input.fromE164)) return false

  const code = extractSmsCode(input.text)
  if (!code) return false

  return markChallengeVerifiedByInboundCode(db, {
    companyId: input.companyId,
    phoneE164: toE164(input.fromE164),
    code,
  })
}
