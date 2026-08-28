import { z } from 'zod'
import { DISPATCH_TASK_STATUSES } from '#shared/utils/domain'
import { requireDriver } from '../../utils/session'
import { updateDriverTask } from '../../services/tasks'

const schema = z.object({
  status: z.enum(DISPATCH_TASK_STATUSES).optional(),
  tripId: z.string().uuid().nullable().optional(),
  steps: z.array(z.object({
    id: z.string().min(1),
    text: z.string().max(2000),
    done: z.boolean(),
  })).max(80).optional(),
})

/** Dismiss, complete, attach, or rewrite checklist steps. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Task id is required.' })
  }
  const body = await readValidatedJson(event, schema)
  if (!body.status && body.tripId === undefined && !body.steps) {
    throw createError({ statusCode: 422, statusMessage: 'Nothing to update.' })
  }
  return { task: await updateDriverTask(useDb(), auth, id, body) }
})
