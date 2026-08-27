import { and, desc, eq, isNull } from 'drizzle-orm'
import { documents } from '../database/schema'
import type { DocumentRecord } from '../database/schema'
import type { Database } from '../utils/db'
import type { AuthContext } from '../utils/session'
import type { DocumentCategory } from '#shared/utils/domain'
import { assertUploadAllowed, buildStorageKey, useObjectStorage } from './storage'
import { recordEvent } from './events'

export interface SaveDocumentInput {
  fileName: string
  mimeType: string
  bytes: Buffer
  category: DocumentCategory
  containerId?: string | null
  tripId?: string | null
  locationId?: string | null
}

export async function saveDocument(
  db: Database,
  auth: AuthContext,
  input: SaveDocumentInput,
): Promise<DocumentRecord> {
  assertUploadAllowed(input.mimeType, input.bytes.length)

  const storage = useObjectStorage()
  const key = buildStorageKey(auth.companyId, input.category, input.fileName)
  const stored = await storage.put(key, input.bytes, input.mimeType)

  const [row] = await db
    .insert(documents)
    .values({
      companyId: auth.companyId,
      category: input.category,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: stored.size,
      storageKey: stored.key,
      checksum: stored.checksum,
      containerId: input.containerId ?? null,
      tripId: input.tripId ?? null,
      locationId: input.locationId ?? null,
      ocrStatus: 'NOT_IMPLEMENTED',
      uploadedByUserId: auth.userId,
    })
    .returning()

  if (!row) {
    throw createError({ statusCode: 500, statusMessage: 'Could not store the document.' })
  }

  if (input.containerId) {
    await recordEvent(db, {
      id: crypto.randomUUID(),
      companyId: auth.companyId,
      containerId: input.containerId,
      eventType: 'DOCUMENT_ADDED',
      actorUserId: auth.userId,
      actorDriverId: auth.driverId,
      tripId: input.tripId ?? null,
      locationId: input.locationId ?? null,
      payload: { documentId: row.id, category: input.category, fileName: input.fileName },
    })
  }

  return row
}

export async function listDocuments(
  db: Database,
  companyId: string,
  filter: { containerId?: string, tripId?: string, limit?: number },
) {
  const clauses = [eq(documents.companyId, companyId), isNull(documents.deletedAt)]
  if (filter.containerId) clauses.push(eq(documents.containerId, filter.containerId))
  if (filter.tripId) clauses.push(eq(documents.tripId, filter.tripId))

  return db
    .select({
      id: documents.id,
      category: documents.category,
      fileName: documents.fileName,
      mimeType: documents.mimeType,
      sizeBytes: documents.sizeBytes,
      containerId: documents.containerId,
      tripId: documents.tripId,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(...clauses))
    .orderBy(desc(documents.createdAt))
    .limit(filter.limit ?? 50)
}
