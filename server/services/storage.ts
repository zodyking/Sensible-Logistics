/**
 * Object storage boundary — self-hosted SeaweedFS via its S3-compatible API
 * (spec 10, 29).
 *
 * Files are always private: the browser never receives a guessable public URL.
 * Downloads go through an authenticated server route that checks tenant and
 * role before streaming or issuing a short-lived signed URL.
 */

export interface StoredObject {
  key: string
  size: number
  contentType: string
  checksum: string | null
}

export interface StorageService {
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  /** Short-lived, authenticated download URL. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>
  healthCheck(): Promise<{ healthy: boolean, message: string }>
}

/** Allowed upload types — validated before a document becomes visible to others. */
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
] as const

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export function assertUploadAllowed(mimeType: string, sizeBytes: number): void {
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw createError({ statusCode: 415, statusMessage: `Unsupported file type: ${mimeType}` })
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'File exceeds the 25 MB limit.' })
  }
}

/** Deterministic, tenant-scoped object key. */
export function buildStorageKey(companyId: string, category: string, fileName: string): string {
  const safe = fileName.replace(/[^\w.-]/g, '_').slice(-120)
  return `${companyId}/${category.toLowerCase()}/${Date.now()}-${crypto.randomUUID()}-${safe}`
}

/**
 * Phase 1 placeholder.
 *
 * TODO(Phase 2): implement `SeaweedS3StorageService` with `@aws-sdk/client-s3`
 * pointed at `NUXT_S3_ENDPOINT` with `forcePathStyle: true`, plus malware
 * scanning before a document becomes readable by other users.
 */
export class NotConfiguredStorageService implements StorageService {
  private unavailable(): never {
    throw createError({
      statusCode: 501,
      statusMessage: 'Object storage is not wired up yet. Configure NUXT_S3_* and enable the SeaweedFS client.',
    })
  }

  async put(): Promise<StoredObject> {
    this.unavailable()
  }

  async get(): Promise<Buffer> {
    this.unavailable()
  }

  async delete(): Promise<void> {
    this.unavailable()
  }

  async signedUrl(): Promise<string> {
    this.unavailable()
  }

  async healthCheck() {
    const endpoint = useRuntimeConfig().s3Endpoint
    return {
      healthy: false,
      message: endpoint
        ? `Endpoint configured (${endpoint}) but the S3 client is not enabled in this build.`
        : 'NUXT_S3_ENDPOINT is not set.',
    }
  }
}

let instance: StorageService | undefined

/**
 * Deliberately not named `useStorage` — that identifier belongs to Nitro's
 * built-in unstorage helper.
 */
export function useObjectStorage(): StorageService {
  if (!instance) instance = new NotConfiguredStorageService()
  return instance
}
