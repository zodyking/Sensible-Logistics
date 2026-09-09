import { z } from 'zod'
import { DISPATCH_TASK_KINDS } from '#shared/utils/domain'
import { requireAdmin } from '../../utils/session'
import { saveDesk } from '../../services/dispatch-desk'

const optionalUuid = z.preprocess(
  value => (value === '' || value === undefined ? null : value),
  z.string().uuid().nullable(),
)

const cardSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(DISPATCH_TASK_KINDS),
  notes: z.string().max(2000).optional().default(''),
  locationId: optionalUuid,
  locationName: z.string().trim().max(120).optional().default(''),
  destinationLocationId: optionalUuid,
  destinationLocationName: z.string().trim().max(120).optional().default(''),
  containerId: optionalUuid,
  containerNumber: z.string().trim().max(20).optional().default(''),
  containerPending: z.boolean().optional().default(false),
})

const schema = z.object({
  driverId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  action: z.enum(['draft', 'submit']),
  cards: z.array(cardSchema).max(40),
})

/** Save a day's dispatch cards as a draft, or send them to the driver. */
export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event)
  const body = await readValidatedJson(event, schema)
  return saveDesk(useDb(), auth, body)
})
