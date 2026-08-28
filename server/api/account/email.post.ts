import { and, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { users } from '../../database/schema'
import { notifyEmailChanged } from '../../services/account-email'
import { assertCurrentPassword, loadAccountUser, refreshSessionUser } from '../../utils/account'

const schema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  email: z.string().trim().email('Enter a valid email address.').max(200),
})

/**
 * Changes the sign-in address after the current password is confirmed.
 *
 * The session stays valid so a typo can be corrected immediately. A notice
 * goes to both the old and new addresses when mail is configured.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const body = await readValidatedJson(event, schema)
  const user = await loadAccountUser(auth.userId)
  await assertCurrentPassword(user.passwordHash, body.currentPassword)

  const email = body.email.toLowerCase()
  if (email === user.email.toLowerCase()) {
    throw createError({ statusCode: 400, statusMessage: 'That is already your email address.' })
  }

  const db = useDb()
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.email}) = ${email}`, ne(users.id, auth.userId)))
    .limit(1)

  if (taken) {
    throw createError({ statusCode: 409, statusMessage: 'That email address is already in use.' })
  }

  const now = new Date()
  await db
    .update(users)
    .set({ email, updatedAt: now })
    .where(eq(users.id, auth.userId))

  await refreshSessionUser(event, auth, { email })
  await notifyEmailChanged({
    firstName: user.firstName,
    oldEmail: user.email,
    newEmail: email,
  })

  return { ok: true, email }
})
