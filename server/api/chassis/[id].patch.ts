import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { chassis, trips } from '../../database/schema'
import { LIVE_TRIP_STATUSES } from '../../services/movements'
import { assertTenant, requireAuth } from '../../utils/session'
import {
  formatChassisNumber,
  isCompleteChassisNumber,
  normalizeChassisNumber,
} from '#shared/utils/iso6346'

const schema = z.object({
  number: z.string().trim().min(1).max(40).optional(),
  provider: z.string().trim().max(80).nullish(),
  sizeCompatibility: z.string().trim().max(40).nullish(),
  licensePlate: z.string().trim().max(40).nullish(),
  notes: z.string().trim().max(400).nullish(),
  outOfService: z.boolean().optional(),
}).refine(body => Object.keys(body).some(key => body[key as keyof typeof body] !== undefined), {
  message: 'Nothing to update.',
})

/** Edit a parked chassis: number, provider, size, plate, notes, and out-of-service. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Chassis id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  const db = useDb()
  const [record] = await db.select().from(chassis).where(eq(chassis.id, id)).limit(1)
  assertTenant(auth, record, 'Chassis')
  if (record!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Chassis not found.' })
  }

  const [live] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(
      eq(trips.companyId, auth.companyId),
      eq(trips.chassisId, id),
      inArray(trips.status, [...LIVE_TRIP_STATUSES]),
    ))
    .limit(1)
  if (live) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Finish or cancel the active trip before editing this chassis.',
    })
  }

  let number = record!.number
  let numberNormalized = record!.numberNormalized
  if (body.number) {
    if (!isCompleteChassisNumber(body.number)) {
      throw createError({
        statusCode: 422,
        statusMessage: 'A chassis number is four letters then six digits.',
      })
    }
    numberNormalized = normalizeChassisNumber(body.number)
    number = formatChassisNumber(numberNormalized) || numberNormalized
    const [taken] = await db
      .select({ id: chassis.id })
      .from(chassis)
      .where(and(
        eq(chassis.companyId, auth.companyId),
        eq(chassis.numberNormalized, numberNormalized),
        isNull(chassis.deletedAt),
      ))
      .limit(1)
    if (taken && taken.id !== id) {
      throw createError({ statusCode: 409, statusMessage: 'That chassis number is already in the pool.' })
    }
  }

  const now = new Date()
  await db
    .update(chassis)
    .set({
      number,
      numberNormalized,
      provider: body.provider !== undefined ? (body.provider || null) : record!.provider,
      sizeCompatibility: body.sizeCompatibility !== undefined
        ? (body.sizeCompatibility || null)
        : record!.sizeCompatibility,
      licensePlate: body.licensePlate !== undefined ? (body.licensePlate || null) : record!.licensePlate,
      notes: body.notes !== undefined ? (body.notes || null) : record!.notes,
      outOfService: body.outOfService ?? record!.outOfService,
      updatedAt: now,
    })
    .where(eq(chassis.id, id))

  const [updated] = await db.select().from(chassis).where(eq(chassis.id, id)).limit(1)
  return { ok: true, chassis: updated }
})
