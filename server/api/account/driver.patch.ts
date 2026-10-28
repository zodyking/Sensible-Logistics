import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { drivers } from '../../database/schema'
import { loadAccountUser, saveDriverPreferredVin } from '../../utils/account'
import { requireDriver } from '../../utils/session'
import { normalizeVin } from '#shared/utils/time-card'

const schema = z.object({
  cdlNumber: z.string().trim().max(30).optional().default(''),
  cdlState: z.string().trim().max(2).optional().default(''),
  truckVin: z.string().trim().max(24).optional().default(''),
})

/** CDL and usual truck VIN for the signed-in driver — used on the daily time card. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const body = await readValidatedJson(event, schema)
  await loadAccountUser(auth.userId)

  const cdlNumber = body.cdlNumber.replace(/\s+/g, '').toUpperCase()
  const cdlState = body.cdlState.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2)
  const truckVin = normalizeVin(body.truckVin)
  if (body.truckVin.trim() && truckVin.length < 6) {
    throw createError({ statusCode: 422, statusMessage: 'Enter a truck VIN of at least 6 characters.' })
  }

  const db = useDb()
  const now = new Date()
  await db
    .update(drivers)
    .set({
      cdlNumber: cdlNumber || null,
      cdlState: cdlState || null,
      updatedAt: now,
    })
    .where(eq(drivers.id, auth.driverId))

  const savedVin = await saveDriverPreferredVin(auth.companyId, auth.driverId, truckVin)

  return {
    ok: true,
    driver: {
      cdlNumber,
      cdlState,
      truckVin: savedVin,
    },
  }
})
