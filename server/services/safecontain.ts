import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * SAFEContain (https://github.com/m-fol/SAFEContain) ships a locally trained
 * Tesseract `eng.traineddata` for ISO 6346 container codes. The 11 MB model is
 * downloaded once into `.data` rather than committed to git.
 */
export const SAFECONTAIN_ENGINE = 'safecontain'
export const SAFECONTAIN_TESSDATA_URL
  = 'https://raw.githubusercontent.com/m-fol/SAFEContain/main/tessdata/eng.traineddata'

const MIN_TESSDATA_BYTES = 1_000_000

export function defaultTessdataDir(): string {
  return process.env.NUXT_OCR_TESSDATA
    || process.env.NUXT_OCR_TESSDATA_DIR
    // Production image runs as a non-root user that cannot write /app/.data.
    || join(tmpdir(), 'safecontain', 'tessdata')
}

export function tessdataFile(dir = defaultTessdataDir()): string {
  return join(dir, 'eng.traineddata')
}

export async function tessdataReady(dir = defaultTessdataDir()): Promise<boolean> {
  try {
    const info = await stat(tessdataFile(dir))
    return info.isFile() && info.size >= MIN_TESSDATA_BYTES
  }
  catch {
    return false
  }
}

let inflight: Promise<string | null> | null = null

/**
 * Return a directory that contains SAFEContain `eng.traineddata`, downloading
 * it on first use when it is not already cached.
 */
export async function ensureSafecontainTessdata(): Promise<string | null> {
  const dir = defaultTessdataDir()
  if (await tessdataReady(dir)) return dir
  if (!inflight) {
    inflight = downloadTessdata(dir).finally(() => {
      inflight = null
    })
  }
  return inflight
}

async function downloadTessdata(dir: string): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true })
    const response = await fetch(SAFECONTAIN_TESSDATA_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(45_000),
    })
    if (!response.ok) {
      throw new Error(`SAFEContain tessdata HTTP ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length < MIN_TESSDATA_BYTES) {
      throw new Error(`SAFEContain tessdata was unexpectedly small (${buffer.length} bytes).`)
    }
    const tmp = join(dir, 'eng.traineddata.tmp')
    await writeFile(tmp, buffer)
    await rename(tmp, tessdataFile(dir))
    return dir
  }
  catch (error) {
    console.warn('[ocr] SAFEContain tessdata download failed:', error instanceof Error ? error.message : error)
    return (await tessdataReady(dir)) ? dir : null
  }
}
