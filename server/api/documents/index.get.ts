import { z } from 'zod'
import { listDocuments } from '../../services/documents'
import { requireAuth } from '../../utils/session'
import { DOCUMENT_CATEGORIES } from '#shared/utils/domain'

const querySchema = z.object({
  containerId: z.string().uuid().optional(),
  tripId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/** Driver-visible document list for a container or trip. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)

  if (!query.containerId && !query.tripId) {
    throw createError({ statusCode: 422, statusMessage: 'Provide a container or trip to list documents.' })
  }

  const items = await listDocuments(useDb(), auth.companyId, query)
  const uploaded = items.map(row => row.category).filter((value): value is (typeof DOCUMENT_CATEGORIES)[number] =>
    (DOCUMENT_CATEGORIES as readonly string[]).includes(value),
  )

  return { items, uploaded }
})
