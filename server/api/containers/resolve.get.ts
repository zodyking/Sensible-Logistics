import { z } from 'zod'
import { previewResolution } from '../../services/activePool'
import { requireDriver } from '../../utils/session'

const querySchema = z.object({
  number: z.string().trim().min(1, 'Enter a container number.').max(40),
})

/**
 * Read-only active-pool preview for the New Pickup screen.
 *
 * Shows the driver what will happen — reuse, reactivate, create, or conflict —
 * before any claim is made (spec 5.3).
 */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const { number } = readValidatedQuery(event, querySchema)

  return previewResolution(useDb(), auth.companyId, auth.driverId, number)
})
