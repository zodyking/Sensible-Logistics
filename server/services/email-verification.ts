import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, gt, isNull } from 'drizzle-orm'
import { emailVerificationTokens, users } from '../database/schema'
import type { DbExecutor } from '../utils/db'
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

function buildMessage(firstName: string, link: string, expiresAt: Date) {
  const hours = Math.round(TOKEN_TTL_MINUTES / 60)
  const appName = String(useRuntimeConfig().public.appName || 'Driver Portal')
  const subject = `Confirm your ${appName} email`

  const text = [
    `Hi ${firstName},`,
    '',
    `Confirm your email address to activate your ${appName} driver account:`,
    '',
    link,
    '',
    `This link expires in ${hours} hours. If you did not create an account, ignore this email.`,
  ].join('\n')

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#EDF0F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0C1E30;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="background:#0C1E30;padding:20px 24px;">
          <span style="color:#FFFFFF;font-weight:700;letter-spacing:0.08em;font-size:14px;">${appName.toUpperCase()}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 24px;">
          <p style="margin:0 0 16px;font-size:16px;">Hi ${firstName},</p>
          <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">
            Confirm your email address to activate your driver account.
          </p>
          <a href="${link}" style="display:block;background:#F0A422;color:#0C1E30;text-decoration:none;font-weight:700;font-size:16px;text-align:center;padding:16px 24px;border-radius:12px;">
            Confirm email address
          </a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#5B6B7C;">
            This link expires in ${hours} hours. If the button does not work, paste this address
            into your browser:<br>
            <span style="word-break:break-all;color:#2C5075;">${link}</span>
          </p>
          <p style="margin:16px 0 0;font-size:13px;color:#5B6B7C;">
            If you did not create an account, you can ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, text, html, expiresAt }
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
  const message = buildMessage(user.firstName, link, expiresAt)

  await mail.send({
    to: user.email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })

  return { devLink: mail.isConfigured() ? null : link }
}
