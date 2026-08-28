import { z } from 'zod'
import { completeDropoff } from '../../../services/movements'
import { attachOpenTasksToTrip, companyTimezone } from '../../../services/tasks'
import { requireDriver } from '../../../utils/session'
import { calendarDateInZone } from '#shared/utils/sms-task'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  destinationLocationId: z.string().uuid('Select a drop-off location.'),
  placement: z.object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    rotation: z.number(),
    x: z.number().optional(),
    y: z.number().optional(),
    zoneId: z.string().uuid().nullish(),
    slotCode: z.string().trim().max(40).nullish(),
  }).nullish(),
  retainChassis: z.boolean().default(false),
  isFinalRelease: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullish(),
  gps: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional(),
  }).nullish(),
})

/** Complete the drop-off and update the container's current state from events. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const tripId = getRouterParam(event, 'id')

  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'Movement id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  const db = useDb()
  const result = await completeDropoff(db, auth, { ...body, tripId })
  try {
    const timezone = await companyTimezone(db, auth.companyId)
    const workDate = calendarDateInZone(
      result.trip.droppedOffAt ?? result.trip.completedAt ?? result.trip.createdAt,
      timezone,
    )
    await attachOpenTasksToTrip(db, {
      companyId: auth.companyId,
      driverId: auth.driverId,
      tripId: result.trip.id,
      workDate,
      kinds: ['DROPOFF', 'LOAD', 'EMPTY', 'WORK', 'NOTE'],
    })
  }
  catch (error) {
    console.warn('[tasks] could not attach dispatch tasks after drop-off', error)
  }
  return result
})
