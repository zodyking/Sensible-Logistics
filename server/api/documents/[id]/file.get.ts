import { and, eq, isNull } from 'drizzle-orm'
import { documents } from '../../../database/schema'
import { requireAuth } from '../../../utils/session'
import { useObjectStorage } from '../../../services/storage'

/** Authenticated download — never a public object URL. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Document id is required.' })
  }

  const db = useDb()
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.companyId, auth.companyId), isNull(documents.deletedAt)))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Document not found.' })
  }

  const body = await useObjectStorage().get(row.storageKey)
  setHeader(event, 'Content-Type', row.mimeType)
  setHeader(event, 'Content-Disposition', `inline; filename="${row.fileName.replace(/"/g, '')}"`)
  setHeader(event, 'Cache-Control', 'private, max-age=60')
  return body
})
