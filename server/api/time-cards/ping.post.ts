import { z } from 'zod'
import { recordTimeCardPing } from '../../services/time-cards'
import { requireDriver } from '../../utils/session'

const schema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).max(50_000).optional(),
  at: z.string().trim().max(40).optional(),
})

/** Background GPS ping while the driver app is open. Denied GPS never reaches here. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const body = await readValidatedJson(event, schema)
  return recordTimeCardPing(useDb(), auth, body)
})
