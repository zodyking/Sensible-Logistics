import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { isValidPhone, toE164 } from '#shared/utils/phone'
import { users } from '../../database/schema'
import { assertCurrentPassword, loadAccountUser } from '../../utils/account'

const schema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  mobileNumber: z.string()
    .trim()
    .max(30)
    .refine(isValidPhone, 'Enter a 10-digit mobile number.'),
})

/** Stores the number in E.164 and clears any prior phone verification. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const body = await readValidatedJson(event, schema)
  const user = await loadAccountUser(auth.userId)
  await assertCurrentPassword(user.passwordHash, body.currentPassword)

  const mobileNumber = toE164(body.mobileNumber)
  const now = new Date()
  const db = useDb()

  await db
    .update(users)
    .set({
      mobileNumber,
      phoneVerifiedAt: null,
      updatedAt: now,
    })
    .where(eq(users.id, auth.userId))

  return { ok: true, mobileNumber }
})
