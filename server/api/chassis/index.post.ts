import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { chassis } from '../../database/schema'
import { requireDriver } from '../../utils/session'

const schema = z.object({
  number: z.string().trim().min(4, 'Enter a chassis number.').max(40),
})

function normalizeChassisNumber(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

/**
 * Find or create a chassis by plate/inventory number so a scanned or typed
 * number on New Pickup can be attached without a separate admin screen.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const body = await readValidatedJson(event, schema)
  const db = useDb()

  const numberNormalized = normalizeChassisNumber(body.number)
  if (numberNormalized.length < 4) {
    throw createError({ statusCode: 422, statusMessage: 'Enter a chassis number.' })
  }

  const [existing] = await db
    .select({
      id: chassis.id,
      number: chassis.number,
      provider: chassis.provider,
      status: chassis.status,
      outOfService: chassis.outOfService,
      sizeCompatibility: chassis.sizeCompatibility,
      currentContainerId: chassis.currentContainerId,
    })
    .from(chassis)
    .where(and(
      eq(chassis.companyId, auth.companyId),
      eq(chassis.numberNormalized, numberNormalized),
      isNull(chassis.deletedAt),
    ))
    .limit(1)

  if (existing) {
    if (existing.outOfService) {
      throw createError({ statusCode: 409, statusMessage: `Chassis ${existing.number} is flagged out of service.` })
    }
    return { item: existing, created: false }
  }

  const [created] = await db
    .insert(chassis)
    .values({
      companyId: auth.companyId,
      number: numberNormalized,
      numberNormalized,
      status: 'AVAILABLE',
    })
    .onConflictDoUpdate({
      target: [chassis.companyId, chassis.numberNormalized],
      set: { number: numberNormalized },
    })
    .returning({
      id: chassis.id,
      number: chassis.number,
      provider: chassis.provider,
      status: chassis.status,
      outOfService: chassis.outOfService,
      sizeCompatibility: chassis.sizeCompatibility,
      currentContainerId: chassis.currentContainerId,
    })

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Could not save the chassis.' })
  }

  if (created.outOfService) {
    throw createError({ statusCode: 409, statusMessage: `Chassis ${created.number} is flagged out of service.` })
  }

  return { item: created, created: !existing }
})
