import { z } from 'zod'
import { patchDriverTimeCard } from '../../services/time-cards'
import { requireDriver } from '../../utils/session'
import { TIME_CARD_STOP_MAX } from '#shared/utils/time-card'

const stopSchema = z.object({
  key: z.string().trim().min(1).max(80),
  timeIn: z.string().trim().max(8).optional().default(''),
  timeOut: z.string().trim().max(8).optional().default(''),
  location: z.string().trim().max(120).optional().default(''),
  activity: z.string().trim().max(80).optional().default(''),
  source: z.enum(['TRIP', 'GPS', 'MANUAL']).optional(),
  tripId: z.string().trim().max(80).nullish(),
  locationId: z.string().trim().max(80).nullish(),
  corrected: z.boolean().optional(),
})

const schema = z.object({
  header: z.object({
    driverName: z.string().trim().max(80).optional(),
    truckUnit: z.string().trim().max(40).optional(),
    trailerNumber: z.string().trim().max(40).optional(),
    cdl: z.string().trim().max(40).optional(),
    employeeId: z.string().trim().max(40).optional(),
    dispatcher: z.string().trim().max(80).optional(),
    routeCustomer: z.string().trim().max(80).optional(),
    startOdometer: z.string().trim().max(20).optional(),
    endOdometer: z.string().trim().max(20).optional(),
    preceding7DayHours: z.string().trim().max(20).optional(),
    signedName: z.string().trim().max(80).optional(),
    signedDate: z.string().trim().max(20).optional(),
  }).optional(),
  stops: z.array(stopSchema).max(TIME_CARD_STOP_MAX).optional(),
})

/** Driver corrections on today's printed card. Auto rows keep updating until edited. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const workDate = getRouterParam(event, 'date')
  if (!workDate) {
    throw createError({ statusCode: 400, statusMessage: 'Work date is required.' })
  }
  const body = await readValidatedJson(event, schema)
  const card = await patchDriverTimeCard(useDb(), auth, workDate, body)
  return { card }
})
