import { z } from 'zod'
import { saveDocument } from '../../services/documents'
import { requireDriver } from '../../utils/session'
import { DOCUMENT_CATEGORIES } from '#shared/utils/domain'

const fieldsSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORIES),
  containerId: z.string().uuid().nullish(),
  tripId: z.string().uuid().nullish(),
  locationId: z.string().uuid().nullish(),
})

/** Capture an EIR, POD, gate ticket or photo against the current swap. */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const parts = await readMultipartFormData(event)

  if (!parts?.length) {
    throw createError({ statusCode: 422, statusMessage: 'Attach a file to upload.' })
  }

  const file = parts.find(part => part.name === 'file' && part.data?.length)
  if (!file) {
    throw createError({ statusCode: 422, statusMessage: 'Choose a photo or PDF to upload.' })
  }

  const fields = Object.fromEntries(
    parts
      .filter(part => part.name && part.name !== 'file')
      .map(part => [part.name, part.data.toString('utf8')]),
  )

  const parsed = fieldsSchema.safeParse(fields)
  if (!parsed.success) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Choose a document type for this upload.',
    })
  }

  const mimeType = file.type || 'application/octet-stream'
  const fileName = file.filename || `upload-${Date.now()}`

  const row = await saveDocument(useDb(), auth, {
    fileName,
    mimeType,
    bytes: Buffer.from(file.data),
    category: parsed.data.category,
    containerId: parsed.data.containerId,
    tripId: parsed.data.tripId,
    locationId: parsed.data.locationId,
  })

  return {
    id: row.id,
    category: row.category,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
  }
})
