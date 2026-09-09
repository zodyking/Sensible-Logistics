import { and, eq, isNull } from 'drizzle-orm'
import { documents } from '../../../database/schema'
import { useObjectStorage } from '../../../services/storage'
import { assertTenant, requireAuth } from '../../../utils/session'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function dispositionName(fileName: string) {
  return fileName.replace(/[\r\n"]/g, '_').slice(-180) || 'document'
}

/** Authenticated document bytes — never a public object-storage URL. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id || !UUID_RE.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Document id is required.' })
  }

  const db = useDb()
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .limit(1)

  assertTenant(auth, doc, 'Document')

  const thumb = getQuery(event).thumb === '1'
  const key = thumb ? (doc!.thumbnailKey || doc!.storageKey) : doc!.storageKey

  const body = await useObjectStorage().get(key)
  setHeader(event, 'Content-Type', doc!.mimeType || 'application/octet-stream')
  setHeader(event, 'Content-Disposition', `inline; filename="${dispositionName(doc!.fileName)}"`)
  setHeader(event, 'Cache-Control', 'private, max-age=120')
  setHeader(event, 'Content-Length', String(body.byteLength))
  return body
})
