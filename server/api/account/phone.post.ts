import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { isValidPhone, phonesEqual, toE164 } from '#shared/utils/phone'
import { users } from '../../database/schema'
import { assertCurrentPassword, loadAccountUser } from '../../utils/account'
import { consumePhoneTicket, isPhoneVerificationRequired } from '../../services/phone-verification'

const schema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  mobileNumber: z.string()
    .trim()
    .max(30)
    .refine(isValidPhone, 'Enter a 10-digit mobile number.'),
  phoneTicket: z.string().trim().max(200).optional(),
})

/** Stores the number in E.164. Quo-backed changes require a consumed SMS ticket. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const body = await readValidatedJson(event, schema)
  const user = await loadAccountUser(auth.userId)
  await assertCurrentPassword(user.passwordHash, body.currentPassword)

  const mobileNumber = toE164(body.mobileNumber)
  const now = new Date()
  const db = useDb()

  if (phonesEqual(mobileNumber, user.mobileNumber)) {
    return { ok: true, mobileNumber }
  }

  const phoneRequired = await isPhoneVerificationRequired(db, auth.companyId)
  if (phoneRequired) {
    await consumePhoneTicket(db, {
      companyId: auth.companyId,
      purpose: 'CHANGE',
      mobileNumber,
      ticket: body.phoneTicket ?? '',
      userId: auth.userId,
    })
  }

  await db
    .update(users)
    .set({
      mobileNumber,
      phoneVerifiedAt: phoneRequired ? now : null,
      updatedAt: now,
    })
    .where(eq(users.id, auth.userId))

  return { ok: true, mobileNumber }
})
