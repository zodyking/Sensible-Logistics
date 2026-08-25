import type { H3Event } from 'h3'
import type { Role } from '#shared/utils/domain'

/**
 * Authenticated request context. Every tenant-scoped query must be filtered by
 * `companyId` from here — never by a company id supplied in the request body.
 */
export interface AuthContext {
  userId: string
  email: string
  firstName: string
  lastName: string
  fullName: string
  role: Role
  companyId: string
  companyName: string
  /** Present for DRIVER memberships; admins have no driver profile. */
  driverId: string | null
}

/**
 * Resolve the caller's session or throw 401.
 *
 * Authorization is always evaluated server-side; hiding UI is never sufficient
 * (spec 21).
 */
export async function requireAuth(event: H3Event): Promise<AuthContext> {
  const session = await getUserSession(event)
  const user = session?.user as AuthContext | undefined

  if (!user?.userId || !user?.companyId) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in required.' })
  }

  return user
}

/** Require an ADMIN membership. */
export async function requireAdmin(event: H3Event): Promise<AuthContext> {
  const auth = await requireAuth(event)
  if (auth.role !== 'ADMIN') {
    throw createError({ statusCode: 403, statusMessage: 'Administrator access required.' })
  }
  return auth
}

/**
 * Require a DRIVER membership with an operational driver profile. Admins are a
 * permission role and deliberately cannot perform driver movements as
 * themselves — their edits are recorded as admin corrections instead (spec 3).
 */
export async function requireDriver(event: H3Event): Promise<AuthContext & { driverId: string }> {
  const auth = await requireAuth(event)
  if (auth.role !== 'DRIVER' || !auth.driverId) {
    throw createError({ statusCode: 403, statusMessage: 'Driver access required.' })
  }
  return auth as AuthContext & { driverId: string }
}

/**
 * Guard for records loaded by id: confirms the row belongs to the caller's
 * company before it is returned or mutated.
 */
export function assertTenant(auth: AuthContext, record: { companyId: string } | undefined | null, label = 'Record'): void {
  if (!record || record.companyId !== auth.companyId) {
    throw createError({ statusCode: 404, statusMessage: `${label} not found.` })
  }
}
