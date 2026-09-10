import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { drivers, users } from '../../../database/schema'
import { loadCompanyDriver } from '../../../utils/admin-drivers'
import { requireAdmin } from '../../../utils/session'

const schema = z.object({
  locked: z.boolean(),
})

/** Lock or unlock a driver account so they cannot sign in. */
export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event)
  const driverId = getRouterParam(event, 'id')
  if (!driverId) {
    throw createError({ statusCode: 400, statusMessage: 'Driver id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  const driver = await loadCompanyDriver(auth, driverId)
  const now = new Date()
  const db = useDb()

  await db.update(users).set({
    disabledAt: body.locked ? now : null,
    updatedAt: now,
  }).where(eq(users.id, driver.userId))

  if (body.locked && driver.driverStatus !== 'INACTIVE') {
    await db.update(drivers).set({
      status: 'INACTIVE',
      updatedAt: now,
    }).where(eq(drivers.id, driver.driverId))
  }

  if (!body.locked && driver.driverStatus === 'INACTIVE') {
    await db.update(drivers).set({
      status: 'AVAILABLE',
      updatedAt: now,
    }).where(eq(drivers.id, driver.driverId))
  }

  return {
    ok: true,
    locked: body.locked,
    lockedAt: body.locked ? now.toISOString() : null,
  }
})
