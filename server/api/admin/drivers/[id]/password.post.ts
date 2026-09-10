import { eq } from 'drizzle-orm'
import { users } from '../../../database/schema'
import { loadCompanyDriver } from '../../../utils/admin-drivers'
import { generateTemporaryPassword } from '../../../utils/passwords'
import { requireAdmin } from '../../../utils/session'

/** Replace a driver's password and return the temporary value once. */
export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event)
  const driverId = getRouterParam(event, 'id')
  if (!driverId) {
    throw createError({ statusCode: 400, statusMessage: 'Driver id is required.' })
  }

  const driver = await loadCompanyDriver(auth, driverId)
  const temporaryPassword = generateTemporaryPassword()
  const passwordHash = await hashPassword(temporaryPassword)
  const now = new Date()
  const db = useDb()

  await db.update(users).set({
    passwordHash,
    updatedAt: now,
  }).where(eq(users.id, driver.userId))

  return {
    ok: true,
    temporaryPassword,
    name: `${driver.firstName} ${driver.lastName}`,
  }
})
