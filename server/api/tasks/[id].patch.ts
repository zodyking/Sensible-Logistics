import { z } from 'zod'
import { DISPATCH_TASK_STATUSES } from '#shared/utils/domain'
import { requireDriver } from '../../utils/session'
import { updateDriverTask } from '../../services/tasks'

const schema = z.object({
  status: z.enum(DISPATCH_TASK_STATUSES).optional(),
  tripId: z.string().uuid().nullable().optional(),
})

/** Dismiss, complete, or attach a dispatch task to a trip. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Task id is required.' })
  }
  const body = await readValidatedJson(event, schema)
  if (!body.status && body.tripId === undefined) {
    throw createError({ statusCode: 422, statusMessage: 'Nothing to update.' })
  }
  return { task: await updateDriverTask(useDb(), auth, id, body) }
})
