import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { isValidPhone, toE164 } from '#shared/utils/phone'
import { membershipRoleForSignup, SIGNUP_ROLES } from '#shared/utils/domain'
import { companyMemberships, drivers, users } from '../../database/schema'
import { sendEmailVerification } from '../../services/email-verification'
import { useMail } from '../../services/mail'

const schema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(80),
  lastName: z.string().trim().min(1, 'Last name is required.').max(80),
  email: z.string().trim().email('Enter a valid email address.').max(200),
  mobileNumber: z.string()
    .trim()
    .max(30)
    .refine(isValidPhone, 'Enter a 10-digit mobile number.'),
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
  inviteCode: z.string().trim().min(1, 'A company invite code is required.').max(60),
  role: z.enum(SIGNUP_ROLES).default('DRIVER'),
})

/**
 * Public self-registration (spec 4).
 *
 * Drivers get a DRIVER membership plus a drivers row. Dispatchers get an ADMIN
 * membership and no drivers row — they use the map board, not the trip home.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, schema)
  const db = useDb()

  const { inviteCode: expectedCode } = readCompanyEnvConfig()

  if (!expectedCode) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Signup is unavailable: NUXT_COMPANY_INVITE_CODE is not configured.',
    })
  }

  if (!inviteCodeMatches(body.inviteCode, expectedCode)) {
    throw createError({ statusCode: 403, statusMessage: 'That invite code is not valid.' })
  }

  // Provisions the company from env on a fresh database, so the first person to
  // sign up does not hit an empty tenant.
  const company = await ensurePrimaryCompany(db)

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${body.email})`)
    .limit(1)

  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'An account already exists for that email address.' })
  }

  // Fail before creating anything if mail is unavailable, so a misconfigured
  // deployment cannot strand someone with an account they can never verify.
  useMail()

  const passwordHash = await hashPassword(body.password)
  const membershipRole = membershipRoleForSignup(body.role)

  const result = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email: body.email.toLowerCase(),
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        // Stored canonically so the same number is never duplicated by format.
        mobileNumber: toE164(body.mobileNumber),
      })
      .returning()

    if (!user) {
      throw createError({ statusCode: 500, statusMessage: 'Could not create the account.' })
    }

    const [membership] = await tx
      .insert(companyMemberships)
      .values({ companyId: company.id, userId: user.id, role: membershipRole, status: 'ACTIVE' })
      .returning()

    if (membershipRole === 'DRIVER') {
      await tx
        .insert(drivers)
        .values({ companyId: company.id, userId: user.id, status: 'AVAILABLE' })
    }

    return { user, membership: membership! }
  })

  // No session yet: the account is inert until the address is confirmed.
  let emailSent = true
  let devLink: string | null = null

  try {
    ({ devLink } = await sendEmailVerification(db, result.user))
  }
  catch (error) {
    // The account exists, so report the delivery failure rather than a 500 —
    // they can retry from the "check your email" screen.
    emailSent = false
    console.error('[signup] verification email failed', error)
  }

  return {
    ok: true,
    verificationRequired: true,
    email: result.user.email,
    emailSent,
    devLink,
  }
})
