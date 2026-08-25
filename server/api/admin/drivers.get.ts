import { and, desc, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { companyMemberships, driverTimecards, drivers, trips, users } from '../../database/schema'
import { requireAdmin } from '../../utils/session'

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['AVAILABLE', 'ON_TRIP', 'OFF_DUTY', 'INACTIVE']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

/** Driver roster with duty state and today's recorded on-duty total. */
export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event)
  const query = readValidatedQuery(event, querySchema)
  const db = useDb()

  const filters = [eq(drivers.companyId, auth.companyId)]
  if (query.status) filters.push(eq(drivers.status, query.status))
  if (query.q) {
    const needle = `%${query.q.toLowerCase()}%`
    filters.push(or(
      sql`lower(${users.firstName}) like ${needle}`,
      sql`lower(${users.lastName}) like ${needle}`,
      sql`lower(${users.email}) like ${needle}`,
      sql`lower(coalesce(${drivers.cdlNumber}, '')) like ${needle}`,
      sql`lower(coalesce(${drivers.driverCode}, '')) like ${needle}`,
    )!)
  }

  const items = await db
    .select({
      id: drivers.id,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      mobileNumber: users.mobileNumber,
      driverCode: drivers.driverCode,
      cdlNumber: drivers.cdlNumber,
      status: drivers.status,
      role: companyMemberships.role,
      membershipStatus: companyMemberships.status,
      lastLoginAt: users.lastLoginAt,
      activeTrips: sql<number>`(
        select count(*)::int from ${trips} t
        where t.driver_id = ${drivers.id}
          and t.status in ('PICKUP_IN_PROGRESS','IN_TRANSIT','DROPOFF_IN_PROGRESS')
      )`,
      openTimecardId: sql<string | null>`(
        select t.id from ${driverTimecards} t
        where t.driver_id = ${drivers.id} and t.status = 'OPEN'
        order by t.work_date desc limit 1
      )`,
    })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .leftJoin(companyMemberships, and(
      eq(companyMemberships.userId, drivers.userId),
      eq(companyMemberships.companyId, drivers.companyId),
    ))
    .where(and(...filters))
    .orderBy(desc(drivers.status), users.lastName)
    .limit(query.limit)

  return { items }
})
