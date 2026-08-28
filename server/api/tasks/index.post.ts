import { z } from 'zod'
import { requireDriver } from '../utils/session'
import { createManualTask } from '../services/tasks'

const schema = z.object({
  text: z.string().trim().min(1, 'Paste the work first.').max(8000),
})

/** Paste a dispatcher blob; each line becomes a checkbox step. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const body = await readValidatedJson(event, schema)
  return { task: await createManualTask(useDb(), auth, body.text) }
})
