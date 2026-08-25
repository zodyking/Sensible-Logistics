import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { emailVerificationTokens, users } from '../database/schema'
import type { DbExecutor } from '../utils/db'
import { readEmailBrand, verificationEmail } from './email'
import { appBaseUrl, useMail } from './mail'

/**
 * Driver email verification (spec 4).
 *
 * The raw token is returned to the caller exactly once, for the link. Only its
 * digest is persisted, so the stored row cannot be replayed.
 */

const TOKEN_TTL_MINUTES = 60 * 24
/** Throttles resends so the endpoint cannot be used to spam an address. */
const RESEND_COOLDOWN_SECONDS = 60

function digest(token: string): Buffer {
  return createHash('sha256').update(token).digest()
}

function hashToken(token: string): string {
  return digest(token).toString('hex')
}

export interface IssuedVerification {
  token: string
  expiresAt: Date
}

/**
 * Invalidates any outstanding links and issues a fresh one, so a forwarded old
 * email stops working as soon as the driver requests another.
 */
export async function issueEmailVerification(
  db: DbExecutor,
  userId: string,
  email: string,
): Promise<IssuedVerification> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000)

  await db
    .update(emailVerificationTokens)
    .set({ consumedAt: new Date() })
    .where(and(
      eq(emailVerificationTokens.userId, userId),
      isNull(emailVerificationTokens.consumedAt),
    ))

  await db.insert(emailVerificationTokens).values({
    userId,
    tokenHash: hashToken(token),
    sentToEmail: email.toLowerCase(),
    expiresAt,
  })

  return { token, expiresAt }
}

/** True when the most recent link for this user is younger than the cooldown. */
export async function isWithinResendCooldown(db: DbExecutor, userId: string): Promise<boolean> {
  const [latest] = await db
    .select({ createdAt: emailVerificationTokens.createdAt })
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.userId, userId))
    .orderBy(desc(emailVerificationTokens.createdAt))
    .limit(1)

  if (!latest) return false
  return Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000
}

export interface VerifiedUser {
  userId: string
  email: string
}

/**
 * Consumes a token and marks the address verified. Returns null for anything
 * invalid, expired or already used — callers must not distinguish between those
 * cases to an unauthenticated visitor.
 */
export async function consumeEmailVerification(
  db: DbExecutor,
  token: string,
): Promise<VerifiedUser | null> {
  const candidate = token.trim()
  if (!candidate) return null

  const [row] = await db
    .select()
    .from(emailVerificationTokens)
    .where(and(
      eq(emailVerificationTokens.tokenHash, hashToken(candidate)),
      isNull(emailVerificationTokens.consumedAt),
      gt(emailVerificationTokens.expiresAt, new Date()),
    ))
    .limit(1)

  if (!row) return null

  // Defence in depth: the lookup above already matched on the digest, but this
  // keeps the final decision on a constant-time comparison.
  if (!timingSafeEqual(digest(candidate), Buffer.from(row.tokenHash, 'hex'))) {
    return null
  }

  const now = new Date()

  await db
    .update(emailVerificationTokens)
    .set({ consumedAt: now })
    .where(eq(emailVerificationTokens.id, row.id))

  const [user] = await db
    .update(users)
    .set({ emailVerifiedAt: now, updatedAt: now })
    .where(eq(users.id, row.userId))
    .returning({ id: users.id, email: users.email })

  if (!user) return null
  return { userId: user.id, email: user.email }
}

function buildMessage(user: { firstName: string, email: string }, link: string, expiresAt: Date) {
  const hours = Math.round(TOKEN_TTL_MINUTES / 60)
  return verificationEmail({
    brand: readEmailBrand(),
    firstName: user.firstName,
    email: user.email,
    confirmUrl: link,
    expiresAt,
    ttlHours: hours,
  })
}

/**
 * Issues a link and emails it. Returns the link itself only in development, so
 * the signup flow can surface it when SMTP is not configured locally.
 */
export async function sendEmailVerification(
  db: DbExecutor,
  user: { id: string, email: string, firstName: string },
): Promise<{ devLink: string | null }> {
  const { token, expiresAt } = await issueEmailVerification(db, user.id, user.email)
  const link = `${appBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`
  const mail = useMail()
  const message = buildMessage(user, link, expiresAt)

  await mail.send({
    to: user.email,
    subject: message.subject,
    text: message.text,
    html: message.html,
    attachments: message.attachments,
  })

  return { devLink: mail.isConfigured() ? null : link }
}
