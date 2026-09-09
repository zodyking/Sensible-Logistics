import { z } from 'zod'
import { requireAdmin } from '../../utils/session'
import { createAssignedTask } from '../../services/tasks'
import { composeDispatchTaskText } from '#shared/utils/dispatch-compose'
import { DISPATCH_TASK_KINDS } from '#shared/utils/domain'

const schema = z.object({
  driverId: z.string().uuid(),
  kind: z.enum(DISPATCH_TASK_KINDS).default('PICKUP'),
  containerNumber: z.string().trim().min(4).max(20),
  locationId: z.string().uuid().optional(),
  locationName: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
})

/** Assign a pool container as a task to a driver. */
export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event)
  const body = await readValidatedJson(event, schema)
  const text = composeDispatchTaskText({
    kind: body.kind,
    containerNumber: body.containerNumber,
    locationName: body.locationName || 'the yard',
    notes: body.notes,
  })
  const task = await createAssignedTask(useDb(), auth, {
    driverId: body.driverId,
    text,
    kind: body.kind,
    containerNumber: body.containerNumber,
    locationId: body.locationId,
    locationName: body.locationName,
  })
  return { task }
})
