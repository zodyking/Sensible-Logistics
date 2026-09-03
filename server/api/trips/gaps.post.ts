import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { tripGaps, trips } from '../../database/schema'
import { requireAuth } from '../../utils/session'
import { GAP_RESOLUTIONS } from '#shared/utils/trip-gaps'

const schema = z.object({
  priorTripId: z.string().uuid(),
  nextTripId: z.string().uuid(),
  resolution: z.enum(GAP_RESOLUTIONS),
})

/**
 * Confirm or clear a bobtail between two trips whose places do not chain.
 * Absence of a row means the hop still reads as a missing trip.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  if (!auth.driverId && auth.role !== 'ADMIN') {
    throw createError({ statusCode: 403, statusMessage: 'Driver access required.' })
  }

  const body = await readValidatedJson(event, schema)
  if (body.priorTripId === body.nextTripId) {
    throw createError({ statusCode: 400, statusMessage: 'A gap needs two different trips.' })
  }

  const db = useDb()
  const pair = await db
    .select({
      id: trips.id,
      driverId: trips.driverId,
    })
    .from(trips)
    .where(and(
      eq(trips.companyId, auth.companyId),
      inArray(trips.id, [body.priorTripId, body.nextTripId]),
    ))

  if (pair.length !== 2) {
    throw createError({ statusCode: 404, statusMessage: 'Those trips were not found.' })
  }

  const prior = pair.find(row => row.id === body.priorTripId)!
  const next = pair.find(row => row.id === body.nextTripId)!
  if (prior.driverId !== next.driverId) {
    throw createError({ statusCode: 400, statusMessage: 'Those trips belong to different drivers.' })
  }
  if (auth.role !== 'ADMIN' && prior.driverId !== auth.driverId) {
    throw createError({ statusCode: 403, statusMessage: 'This movement belongs to another driver.' })
  }

  if (body.resolution === 'MISSING') {
    await db.delete(tripGaps).where(and(
      eq(tripGaps.companyId, auth.companyId),
      eq(tripGaps.priorTripId, body.priorTripId),
      eq(tripGaps.nextTripId, body.nextTripId),
    ))
    return { priorTripId: body.priorTripId, nextTripId: body.nextTripId, resolution: 'MISSING' as const }
  }

  const now = new Date()
  const [existing] = await db
    .select({ id: tripGaps.id })
    .from(tripGaps)
    .where(and(
      eq(tripGaps.priorTripId, body.priorTripId),
      eq(tripGaps.nextTripId, body.nextTripId),
    ))
    .limit(1)

  if (existing) {
    await db.update(tripGaps).set({
      resolution: 'BOBTAIL',
      updatedAt: now,
    }).where(eq(tripGaps.id, existing.id))
  }
  else {
    await db.insert(tripGaps).values({
      companyId: auth.companyId,
      driverId: prior.driverId,
      priorTripId: body.priorTripId,
      nextTripId: body.nextTripId,
      resolution: 'BOBTAIL',
    })
  }

  return { priorTripId: body.priorTripId, nextTripId: body.nextTripId, resolution: 'BOBTAIL' as const }
})
