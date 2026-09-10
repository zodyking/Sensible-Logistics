import { and, eq } from 'drizzle-orm'
import { companyMemberships, drivers, users } from '../database/schema'
import type { AuthContext } from './session'

export interface CompanyDriver {
  driverId: string
  userId: string
  firstName: string
  lastName: string
  email: string
  disabledAt: Date | null
  driverStatus: typeof drivers.$inferSelect['status']
  role: typeof companyMemberships.$inferSelect['role'] | null
}

export async function loadCompanyDriver(auth: AuthContext, driverId: string): Promise<CompanyDriver> {
  const db = useDb()
  const [row] = await db
    .select({
      driverId: drivers.id,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      disabledAt: users.disabledAt,
      driverStatus: drivers.status,
      role: companyMemberships.role,
    })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .leftJoin(companyMemberships, and(
      eq(companyMemberships.userId, drivers.userId),
      eq(companyMemberships.companyId, drivers.companyId),
    ))
    .where(and(eq(drivers.id, driverId), eq(drivers.companyId, auth.companyId)))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Driver not found.' })
  }

  if (row.userId === auth.userId) {
    throw createError({ statusCode: 403, statusMessage: 'You cannot change your own access from this roster.' })
  }

  if (row.role === 'ADMIN') {
    throw createError({ statusCode: 403, statusMessage: 'Dispatcher accounts are managed separately.' })
  }

  return row
}
