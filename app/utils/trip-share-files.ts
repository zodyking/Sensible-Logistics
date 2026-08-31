/**
 * Client-side files that ride along with a pickup SMS (container photos and
 * any documents the driver attached during that movement). Drop-off SMS does
 * not read this store.
 *
 * Object storage is still Phase 2, so these stay on the device in IndexedDB
 * with an in-memory cache for the current session.
 */

export type TripShareKind = 'photo' | 'document'

export interface TripShareFile {
  kind: TripShareKind
  fileName: string
  mimeType: string
  dataUrl: string
}

const DB_NAME = 'sensible-trip-share'
const STORE = 'files'
const memory = new Map<string, TripShareFile[]>()

function mimeFromDataUrl(dataUrl: string): string {
  return /data:([^;]+)/.exec(dataUrl)?.[1] || 'application/octet-stream'
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png'
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/heic') return 'heic'
  if (mimeType === 'application/pdf') return 'pdf'
  return 'jpg'
}

function decodeBase64(payload: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(payload, 'base64'))
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const comma = dataUrl.indexOf(',')
  const meta = comma >= 0 ? dataUrl.slice(0, comma) : ''
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const mimeType = /data:([^;]+)/.exec(meta)?.[1] || 'application/octet-stream'
  return new File([decodeBase64(payload)], fileName, { type: mimeType })
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function persist(tripId: string, files: TripShareFile[]): Promise<void> {
  memory.set(tripId, files)
  if (!import.meta.client || typeof indexedDB === 'undefined') return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.objectStore(STORE).put(files, tripId)
    })
    db.close()
  }
  catch {
    // Sharing still works from the in-memory cache for this session.
  }
}

export async function listTripShareFiles(tripId: string): Promise<TripShareFile[]> {
  const cached = memory.get(tripId)
  if (cached) return cached
  if (!import.meta.client || typeof indexedDB === 'undefined') return []
  try {
    const db = await openDb()
    const files = await new Promise<TripShareFile[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const request = tx.objectStore(STORE).get(tripId)
      request.onsuccess = () => resolve(request.result ?? [])
      request.onerror = () => reject(request.error)
    })
    db.close()
    memory.set(tripId, files)
    return files
  }
  catch {
    return []
  }
}

export async function rememberTripShareFile(tripId: string, file: TripShareFile): Promise<void> {
  const current = [...await listTripShareFiles(tripId)]
  const index = current.findIndex(item => item.fileName === file.fileName)
  if (index >= 0) current[index] = file
  else current.push(file)
  await persist(tripId, current)
}

export function nextShareTitle(
  kind: 'container' | 'document',
  existing: Array<{ fileName: string }>,
  mimeType: string,
): string {
  const stem = kind === 'container' ? 'container image' : 'document image'
  const ext = extensionForMime(mimeType)
  const numbered = new RegExp(`^${stem} (\\d+)\\.`, 'i')
  let max = 0
  for (const item of existing) {
    const match = numbered.exec(item.fileName)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${stem} ${max + 1}.${ext}`
}

export async function rememberTripPhoto(tripId: string, dataUrl: string): Promise<void> {
  if (!tripId || !dataUrl.startsWith('data:')) return
  const mimeType = mimeFromDataUrl(dataUrl)
  const current = await listTripShareFiles(tripId)
  const fileName = nextShareTitle('container', current, mimeType)
  await rememberTripShareFile(tripId, { kind: 'photo', fileName, mimeType, dataUrl })
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

function uniqueFileName(existing: TripShareFile[], fileName: string): string {
  if (!existing.some(item => item.fileName === fileName)) return fileName
  const dot = fileName.lastIndexOf('.')
  const base = dot >= 0 ? fileName.slice(0, dot) : fileName
  const ext = dot >= 0 ? fileName.slice(dot) : ''
  let n = 2
  while (existing.some(item => item.fileName === `${base}-${n}${ext}`)) n += 1
  return `${base}-${n}${ext}`
}

/** Extra photos or PDFs the driver attaches from Trip documents. */
export async function rememberTripShareBlobs(tripId: string, files: File[]): Promise<void> {
  if (!tripId || !files.length) return
  const current = [...await listTripShareFiles(tripId)]
  for (const file of files) {
    const dataUrl = await fileToDataUrl(file)
    if (!dataUrl.startsWith('data:')) continue
    const mimeType = file.type || mimeFromDataUrl(dataUrl)
    current.push({
      kind: 'document',
      fileName: nextShareTitle('document', current, mimeType),
      mimeType,
      dataUrl,
    })
  }
  await persist(tripId, current)
}

export async function tripShareFilesAsFiles(tripId: string): Promise<File[]> {
  const stored = await listTripShareFiles(tripId)
  return stored.map(file => dataUrlToFile(file.dataUrl, file.fileName))
}

/** Files from one or more trips, with unique names so a swap can attach both boxes. */
export async function tripShareFilesAsFilesFromTrips(tripIds: Array<string | null | undefined>): Promise<File[]> {
  const names: TripShareFile[] = []
  const files: File[] = []
  for (const tripId of tripIds) {
    if (!tripId) continue
    for (const stored of await listTripShareFiles(tripId)) {
      const fileName = uniqueFileName(names, stored.fileName)
      names.push({ ...stored, fileName })
      files.push(dataUrlToFile(stored.dataUrl, fileName))
    }
  }
  return files
}

/**
 * Default: every file is selected. After an add/reload, keep the driver's
 * ticks and auto-select files that were not on the list before.
 */
export function nextAttachmentSelection(
  previousSelected: Iterable<string>,
  previousNames: Iterable<string>,
  nextNames: Iterable<string>,
): Set<string> {
  const selectedBefore = new Set(previousSelected)
  const known = new Set(previousNames)
  const selected = new Set<string>()
  for (const name of nextNames) {
    if (selectedBefore.has(name) || !known.has(name)) selected.add(name)
  }
  return selected
}

export async function deleteTripShareFile(tripId: string, fileName: string): Promise<void> {
  const current = (await listTripShareFiles(tripId)).filter(item => item.fileName !== fileName)
  await persist(tripId, current)
}
