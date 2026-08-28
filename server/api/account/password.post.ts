import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { users } from '../../database/schema'
import { assertCurrentPassword, loadAccountUser } from '../../utils/account'

const schema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
})

/** Replaces the password hash after confirming the existing one. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const body = await readValidatedJson(event, schema)
  const user = await loadAccountUser(auth.userId)
  await assertCurrentPassword(user.passwordHash, body.currentPassword)

  if (body.password === body.currentPassword) {
    throw createError({ statusCode: 400, statusMessage: 'Choose a different password.' })
  }

  const passwordHash = await hashPassword(body.password)
  const now = new Date()
  const db = useDb()

  await db
    .update(users)
    .set({ passwordHash, updatedAt: now })
    .where(eq(users.id, auth.userId))

  return { ok: true }
})
