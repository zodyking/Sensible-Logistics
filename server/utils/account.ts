import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { users } from '../database/schema'
import type { AuthContext } from './session'

export interface AccountUser {
  id: string
  email: string
  passwordHash: string
  firstName: string
  lastName: string
  mobileNumber: string | null
}

/** Load the signed-in user row, or treat a missing/disabled account as signed out. */
export async function loadAccountUser(userId: string): Promise<AccountUser> {
  const db = useDb()
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      firstName: users.firstName,
      lastName: users.lastName,
      mobileNumber: users.mobileNumber,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user || user.disabledAt) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in required.' })
  }

  return user
}

export async function assertCurrentPassword(passwordHash: string, password: string): Promise<void> {
  const valid = await verifyPassword(passwordHash, password)
  if (!valid) {
    throw createError({ statusCode: 403, statusMessage: 'Current password is incorrect.' })
  }
}

/**
 * Rewrite the public session fields after a profile change so More / Home
 * pick up the new name or email without a second sign-in.
 */
export async function refreshSessionUser(
  event: H3Event,
  auth: AuthContext,
  patch: Partial<Pick<AuthContext, 'email' | 'firstName' | 'lastName'>>,
): Promise<void> {
  const session = await getUserSession(event)
  const firstName = patch.firstName ?? auth.firstName
  const lastName = patch.lastName ?? auth.lastName

  await setUserSession(event, {
    user: {
      ...auth,
      ...patch,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
    },
    secure: session.secure,
    loggedInAt: session.loggedInAt ?? new Date().toISOString(),
  })
}
