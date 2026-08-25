import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { companies, companyMemberships, drivers, users } from '../../database/schema'

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

/** Generic failure message — never reveals whether the email exists. */
const INVALID = 'Email or password is incorrect.'

/**
 * Session sign-in.
 *
 * Admins are routed straight to a management page; there is deliberately no
 * admin dashboard (spec 3).
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, schema)
  const db = useDb()

  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${body.email})`)
    .limit(1)

  if (!user || user.disabledAt) {
    throw createError({ statusCode: 401, statusMessage: INVALID })
  }

  const valid = await verifyPassword(user.passwordHash, body.password)
  if (!valid) {
    throw createError({ statusCode: 401, statusMessage: INVALID })
  }

  // Checked only after the password succeeds, so this cannot be used to probe
  // which addresses are registered.
  if (!user.emailVerifiedAt) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Confirm your email address before signing in. Check your inbox for the link.',
      data: { emailVerificationRequired: true, email: user.email },
    })
  }

  const [membership] = await db
    .select({
      id: companyMemberships.id,
      role: companyMemberships.role,
      status: companyMemberships.status,
      companyId: companies.id,
      companyName: companies.name,
    })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(and(eq(companyMemberships.userId, user.id), eq(companyMemberships.status, 'ACTIVE')))
    .limit(1)

  if (!membership) {
    throw createError({ statusCode: 403, statusMessage: 'Your account is not active in any company.' })
  }

  let driverId: string | null = null
  if (membership.role === 'DRIVER') {
    const [driver] = await db
      .select({ id: drivers.id })
      .from(drivers)
      .where(and(eq(drivers.userId, user.id), eq(drivers.companyId, membership.companyId)))
      .limit(1)
    driverId = driver?.id ?? null
  }

  await setUserSession(event, {
    user: {
      userId: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: `${user.firstName} ${user.lastName}`,
      role: membership.role,
      companyId: membership.companyId,
      companyName: membership.companyName,
      driverId,
    },
    secure: { membershipId: membership.id },
    loggedInAt: new Date().toISOString(),
  })

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id))

  return {
    ok: true,
    role: membership.role,
    redirectTo: membership.role === 'ADMIN' ? '/admin/containers' : '/',
  }
})
