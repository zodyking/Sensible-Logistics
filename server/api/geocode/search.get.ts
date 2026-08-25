import { z } from 'zod'
import { useGeocoder } from '../../services/geocoding'
import { requireAuth } from '../../utils/session'

const querySchema = z.object({
  q: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(8).default(6),
})

/** Address typeahead. Proxied so the browser never talks to Photon directly. */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)
  return useGeocoder().search(query.q, query.limit)
})
