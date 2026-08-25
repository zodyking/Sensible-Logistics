import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { containers, documents, trips, users } from '../../database/schema'
import { requireAdmin } from '../../utils/session'
import { DOCUMENT_CATEGORIES } from '#shared/utils/domain'

const querySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** Document review queue. OCR text is indexed here for global search (spec 11). */
export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event)
  const query = readValidatedQuery(event, querySchema)
  const db = useDb()

  const filters = [eq(documents.companyId, auth.companyId), isNull(documents.deletedAt)]
  if (query.category) filters.push(eq(documents.category, query.category))
  if (query.q) {
    const needle = `%${query.q.toLowerCase()}%`
    filters.push(sql`(
      lower(${documents.fileName}) like ${needle}
      or lower(coalesce(${documents.extractedText}, '')) like ${needle}
    )`)
  }

  const items = await db
    .select({
      id: documents.id,
      category: documents.category,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      ocrStatus: documents.ocrStatus,
      createdAt: documents.createdAt,
      containerNumber: containers.number,
      tripReference: trips.reference,
      uploadedBy: sql<string | null>`nullif(concat_ws(' ', ${users.firstName}, ${users.lastName}), '')`,
    })
    .from(documents)
    .leftJoin(containers, eq(containers.id, documents.containerId))
    .leftJoin(trips, eq(trips.id, documents.tripId))
    .leftJoin(users, eq(users.id, documents.uploadedByUserId))
    .where(and(...filters))
    .orderBy(desc(documents.createdAt))
    .limit(query.limit)

  const [totals] = await db
    .select({
      total: sql<number>`count(*)::int`,
      pendingOcr: sql<number>`count(*) filter (where ${documents.ocrStatus} = 'PENDING')::int`,
    })
    .from(documents)
    .where(and(eq(documents.companyId, auth.companyId), isNull(documents.deletedAt)))

  return { items, totals: totals ?? { total: 0, pendingOcr: 0 } }
})
