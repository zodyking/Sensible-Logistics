import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { companies, companyMemberships, drivers, users } from '../../database/schema'
import { consumeEmailVerification } from '../../services/email-verification'

const schema = z.object({
  token: z.string().trim().min(1, 'A verification token is required.').max(400),
})

/**
 * Confirms a driver's email address and signs them in (spec 4).
 *
 * Signing in here is deliberate: the link proves control of the address, and it
 * saves a driver standing in a yard from typing their password again.
 */
export default defineEventHandler(async (event) => {
  const body = await readValidatedJson(event, schema)
  const db = useDb()

  const verified = await consumeEmailVerification(db, body.token)

  if (!verified) {
    throw createError({
      statusCode: 400,
      statusMessage: 'This verification link is invalid or has expired. Request a new one.',
    })
  }

  const [user] = await db.select().from(users).where(eq(users.id, verified.userId)).limit(1)

  if (!user || user.disabledAt) {
    throw createError({ statusCode: 403, statusMessage: 'This account is not active.' })
  }

  const [membership] = await db
    .select({
      id: companyMemberships.id,
      role: companyMemberships.role,
      companyId: companies.id,
      companyName: companies.name,
    })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    .where(eq(companyMemberships.userId, user.id))
    .limit(1)

  if (!membership) {
    throw createError({ statusCode: 403, statusMessage: 'Your account is not active in any company.' })
  }

  let driverId: string | null = null
  if (membership.role === 'DRIVER') {
    const [driver] = await db
      .select({ id: drivers.id })
      .from(drivers)
      .where(eq(drivers.userId, user.id))
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
    redirectTo: membership.role === 'ADMIN' ? '/admin/containers' : '/',
  }
})
