import { z } from 'zod'
import { confirmPickup } from '../../../services/movements'
import { attachOpenTasksToTrip, companyTimezone } from '../../../services/tasks'
import { requireDriver } from '../../../utils/session'
import { calendarDateInZone } from '#shared/utils/sms-task'

const schema = z.object({
  eventId: z.string().uuid('An idempotency key is required.'),
  chassisId: z.string().uuid().nullish(),
  destinationLocationId: z.string().uuid('Choose a drop-off location.').nullish(),
  isLoaded: z.boolean(),
  sealNumber: z.string().trim().max(60).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  gps: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional(),
  }).nullish(),
})

/** Confirm Pickup — container moves into driver custody / in transit. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const tripId = getRouterParam(event, 'id')

  if (!tripId) {
    throw createError({ statusCode: 400, statusMessage: 'Movement id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  const db = useDb()
  const result = await confirmPickup(db, auth, { ...body, tripId })
  try {
    const timezone = await companyTimezone(db, auth.companyId)
    const workDate = calendarDateInZone(result.trip.pickedUpAt ?? result.trip.createdAt, timezone)
    await attachOpenTasksToTrip(db, {
      companyId: auth.companyId,
      driverId: auth.driverId,
      tripId: result.trip.id,
      workDate,
      kinds: ['PICKUP', 'LOAD', 'EMPTY', 'WORK', 'NOTE'],
    })
  }
  catch (error) {
    console.warn('[tasks] could not attach dispatch tasks after pickup', error)
  }
  return result
})
