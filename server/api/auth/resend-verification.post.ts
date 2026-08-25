import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { users } from '../../database/schema'
import { isWithinResendCooldown, sendEmailVerification } from '../../services/email-verification'

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(200),
})

/**
 * Re-sends a verification link.
 *
 * Always reports success: revealing whether an address is registered, or
 * already verified, would turn this into an account-enumeration oracle.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, schema)
  const db = useDb()
  const generic = { ok: true, message: 'If that address needs verification, a new link is on its way.' }

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${body.email})`)
    .limit(1)

  if (!user || user.emailVerifiedAt || user.disabledAt) return generic
  if (await isWithinResendCooldown(db, user.id)) return generic

  try {
    const { devLink } = await sendEmailVerification(db, user)
    return { ...generic, devLink }
  }
  catch (error) {
    console.error('[resend-verification] delivery failed', error)
    return generic
  }
})
