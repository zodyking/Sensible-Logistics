/**
 * Client-side files that ride along with a pickup SMS (container photos and
 * any documents the driver attached during that movement). Drop-off SMS does
 * not read this store.
 *
 * Object storage is still Phase 2, so these stay on the device in IndexedDB
 * with an in-memory cache for the current session.
 */

import { formatChassisNumber, formatContainerNumber } from '../../shared/utils/iso6346'

export type TripShareKind = 'photo' | 'document'
export type ShareTitleKind = 'container' | 'chassis' | 'document'

export type ShareNameInput = {
  containerNumber?: string | null
  chassisNumber?: string | null
}

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

function sanitizeStem(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function photoStem(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/ \d+$/, '')
}

function isGenericPhotoName(fileName: string): boolean {
  return /^(container image|document image|container|chassis|scan)\b/i.test(fileName)
}

function shouldReplacePhoto(item: TripShareFile, stem: string): boolean {
  if (item.kind !== 'photo') return false
  const prior = photoStem(item.fileName)
  if (isGenericPhotoName(item.fileName) || prior === stem) return true
  const compact = stem.replace(/-\d$/, '')
  return Boolean(prior) && (stem.startsWith(prior) || compact.startsWith(prior) || prior.startsWith(compact))
}

/** Container number when present, otherwise the chassis number. */
export function scanShareStem(names: ShareNameInput = {}): string {
  const container = sanitizeStem(formatContainerNumber(names.containerNumber ?? '') || String(names.containerNumber ?? ''))
  if (container) return container
  const chassis = sanitizeStem(formatChassisNumber(names.chassisNumber ?? '') || String(names.chassisNumber ?? ''))
  if (chassis) return chassis
  return 'scan'
}

export function nextShareTitle(
  kind: ShareTitleKind,
  existing: Array<{ fileName: string }>,
  mimeType: string,
  names: ShareNameInput = {},
): string {
  const ext = extensionForMime(mimeType)
  if (kind === 'document') {
    const numbered = /^document (\d+)\./i
    let max = 0
    for (const item of existing) {
      const match = numbered.exec(item.fileName)
      if (match) max = Math.max(max, Number(match[1]))
    }
    return `document ${max + 1}.${ext}`
  }

  const stem = scanShareStem(names)
  const exact = `${stem}.${ext}`
  if (!existing.some(item => item.fileName.toLowerCase() === exact.toLowerCase())) return exact
  const extra = new RegExp(`^${escapeRegExp(stem)} (\\d+)\\.${escapeRegExp(ext)}$`, 'i')
  let n = 2
  for (const item of existing) {
    const match = extra.exec(item.fileName)
    if (match) n = Math.max(n, Number(match[1]) + 1)
  }
  return `${stem} ${n}.${ext}`
}

export function isLegacyShareName(fileName: string): boolean {
  return /^(container image|document image)\b/i.test(fileName)
    || /^(container|chassis|scan)(?:\s|$|\.)/i.test(fileName)
}

function isLegacyScanName(fileName: string): boolean {
  return /^(container image)\b/i.test(fileName)
    || /^(container|chassis|scan)(?:\s|$|\.)/i.test(fileName)
}

/** Name shown in Documents / SMS — equipment number when the stored name is leftover. */
export function displayShareFileName(file: Pick<TripShareFile, 'fileName' | 'kind' | 'mimeType'>, names: ShareNameInput): string {
  return backfillShareFiles([{
    kind: file.kind,
    fileName: file.fileName,
    mimeType: file.mimeType,
    dataUrl: '',
  }], names)[0]?.fileName ?? file.fileName
}

/**
 * One entry per photo. The old pickup screen saved the same capture twice —
 * once from the watcher and once on confirm — so identical bytes collapse.
 */
export function dedupeShareFiles(files: readonly TripShareFile[]): TripShareFile[] {
  const seen = new Set<string>()
  const unique: TripShareFile[] = []
  for (const file of files) {
    if (file.dataUrl) {
      if (seen.has(file.dataUrl)) continue
      seen.add(file.dataUrl)
    }
    unique.push(file)
  }
  return unique
}

/** Rename leftover generic scans/docs to equipment numbers and document 1, 2, 3… */
export function backfillShareFiles(
  files: readonly TripShareFile[],
  names: ShareNameInput,
): TripShareFile[] {
  const next: TripShareFile[] = []
  const photoKind: ShareTitleKind = names.containerNumber?.trim()
    ? 'container'
    : names.chassisNumber?.trim()
      ? 'chassis'
      : 'container'
  const canRenameScan = scanShareStem(names) !== 'scan'

  for (const file of dedupeShareFiles(files)) {
    if (/^document image\b/i.test(file.fileName)) {
      next.push({
        ...file,
        kind: 'document',
        fileName: nextShareTitle('document', next, file.mimeType),
      })
      continue
    }
    if (canRenameScan && isLegacyScanName(file.fileName)) {
      next.push({
        ...file,
        kind: 'photo',
        fileName: nextShareTitle(photoKind, next, file.mimeType, names),
      })
      continue
    }
    next.push(file)
  }
  return next
}

export async function backfillTripShareFiles(tripId: string, names: ShareNameInput): Promise<TripShareFile[]> {
  const current = await listTripShareFiles(tripId)
  const next = backfillShareFiles(current, names)
  const changed = next.length !== current.length || next.some((file, index) => (
    file.fileName !== current[index]?.fileName || file.kind !== current[index]?.kind
  ))
  if (changed) await persist(tripId, next)
  return next
}

export async function rememberTripPhoto(
  tripId: string,
  dataUrl: string,
  names: ShareNameInput = {},
): Promise<void> {
  if (!tripId || !dataUrl.startsWith('data:')) return
  const mimeType = mimeFromDataUrl(dataUrl)
  const current = [...await listTripShareFiles(tripId)]
  const kind: ShareTitleKind = names.containerNumber?.trim() ? 'container' : names.chassisNumber?.trim() ? 'chassis' : 'container'
  const stem = scanShareStem(names)
  const kept = current.filter(item => item.dataUrl !== dataUrl && !shouldReplacePhoto(item, stem))
  const fileName = nextShareTitle(kind, kept, mimeType, names)
  kept.push({ kind: 'photo', fileName, mimeType, dataUrl })
  await persist(tripId, dedupeShareFiles(kept))
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
  while (existing.some(item => item.fileName === `${base} ${n}${ext}`)) n += 1
  return `${base} ${n}${ext}`
}

export function isImageShareFile(file: { mimeType: string }): boolean {
  return file.mimeType.startsWith('image/')
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  const meta = comma >= 0 ? dataUrl.slice(0, comma) : ''
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const mime = /data:([^;]+)/.exec(meta)?.[1] || 'application/octet-stream'
  return new Blob([decodeBase64(payload)], { type: mime })
}

/** Extra photos or PDFs the driver attaches from Trip documents. */
export async function rememberTripShareBlobs(tripId: string, files: File[]): Promise<void> {
  if (!tripId || !files.length) return
  const current = [...await listTripShareFiles(tripId)]
  for (const file of files) {
    const dataUrl = await fileToDataUrl(file)
    if (!dataUrl.startsWith('data:')) continue
    if (current.some(item => item.dataUrl === dataUrl)) continue
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
  const stored = dedupeShareFiles(await listTripShareFiles(tripId))
  return stored.map(file => dataUrlToFile(file.dataUrl, file.fileName))
}

/** Files from one or more trips, with unique names so a swap can attach both boxes. */
export async function listTripShareFilesFromTrips(
  tripIds: Array<string | null | undefined>,
  namesByTrip: Record<string, ShareNameInput> = {},
): Promise<TripShareFile[]> {
  const names: TripShareFile[] = []
  const items: TripShareFile[] = []
  for (const tripId of tripIds) {
    if (!tripId) continue
    const stored = namesByTrip[tripId]
      ? await backfillTripShareFiles(tripId, namesByTrip[tripId]!)
      : dedupeShareFiles(await listTripShareFiles(tripId))
    for (const file of stored) {
      const fileName = uniqueFileName(names, file.fileName)
      const item = { ...file, fileName }
      names.push(item)
      items.push(item)
    }
  }
  return items
}

export async function tripShareFilesAsFilesFromTrips(tripIds: Array<string | null | undefined>): Promise<File[]> {
  return (await listTripShareFilesFromTrips(tripIds)).map(file => dataUrlToFile(file.dataUrl, file.fileName))
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
