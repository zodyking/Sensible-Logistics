import type { DocumentCategory } from '#shared/utils/domain'

export interface ViewerDocument {
  id: string
  fileName: string
  category: DocumentCategory | string
  mimeType?: string | null
  createdAt?: string | Date | null
}

export function documentFileSrc(id: string, thumb = false) {
  return thumb ? `/api/documents/${id}/file?thumb=1` : `/api/documents/${id}/file`
}

export function isImageDocument(doc: Pick<ViewerDocument, 'mimeType' | 'category' | 'fileName'>) {
  if (doc.mimeType?.startsWith('image/')) return true
  if (doc.category === 'PHOTO') return true
  return /\.(jpe?g|png|webp|gif|heic|bmp)$/i.test(doc.fileName)
}
