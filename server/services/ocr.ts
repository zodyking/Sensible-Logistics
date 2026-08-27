import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isTesseractTsv, parseEquipmentReadings, visibleOcrTranscript } from '#shared/utils/ocr-parse'
import { generateCorrectionCandidates, validateContainerNumber } from '#shared/utils/iso6346'
import {
  ensureSafecontainTessdata,
  SAFECONTAIN_ENGINE,
  tessdataReady,
} from './safecontain'

/**
 * Local OCR engine boundary (spec 30.7, 34).
 *
 * Inference never runs in the browser. Scene-text reading uses Tesseract with
 * SAFEContain's trained `eng.traineddata` (ISO 6346 container codes). The
 * model is cached under a writable temp dir on first scan.
 * `NUXT_OCR_SERVICE_URL` remains an optional override for a future sidecar.
 */

export interface OcrRegion {
  text: string
  confidence: number
  /** [x, y, width, height] in source-image pixels. */
  box: [number, number, number, number]
}

export interface OcrCandidate {
  value: string
  confidence: number
  checkDigitValid: boolean
  /** Zero-based indexes the engine flagged as uncertain. */
  lowConfidenceIndexes: number[]
  /** Where the candidate was read from, for the confirmation crop. */
  box?: [number, number, number, number]
}

export interface SceneTextResult {
  available: boolean
  engine: string
  engineVersion: string | null
  modelName: string | null
  preprocessingProfile: string | null
  regions: OcrRegion[]
  /** Ranked best-first. A scan returns candidates, never one magic string. */
  candidates: OcrCandidate[]
  rawText: string
  latencyMs: number
  message?: string
}

export interface DocumentOcrResult {
  available: boolean
  engine: string
  engineVersion: string | null
  text: string
  fields: Record<string, { value: string, confidence: number, page: number, box?: [number, number, number, number] }>
  latencyMs: number
  message?: string
}

export interface OcrHealth {
  healthy: boolean
  engine: string
  engineVersion: string | null
  message: string
}

/** The contract named in spec 30.7. */
export interface OcrService {
  recognizeSceneText(image: Buffer, options?: { profile?: 'container' | 'chassis' | 'seal' }): Promise<SceneTextResult>
  recognizeDocument(file: Buffer, options?: { mimeType?: string }): Promise<DocumentOcrResult>
  healthCheck(): Promise<OcrHealth>
  engineVersion(): Promise<string | null>
}

const ENGINE = SAFECONTAIN_ENGINE
const WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function imageExtension(buffer: Buffer): 'jpg' | 'png' | 'webp' {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return 'jpg'
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return 'png'
  if (buffer.length >= 12 && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  return 'jpg'
}

function runCommand(command: string, args: string[], timeoutMs = 20_000): Promise<{ stdout: string, stderr: string, code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`${command} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, code })
    })
  })
}

let resolvedBinary: string | null | undefined
let resolvedVersion: string | null | undefined

async function tesseractBinary(): Promise<string | null> {
  if (resolvedBinary !== undefined) return resolvedBinary
  try {
    const result = await runCommand('tesseract', ['--version'], 5_000)
    if (result.code === 0) {
      resolvedBinary = 'tesseract'
      const match = result.stdout.match(/tesseract\s+([0-9.]+)/i) ?? result.stderr.match(/tesseract\s+([0-9.]+)/i)
      resolvedVersion = match?.[1] ?? result.stdout.trim().split('\n')[0] ?? null
      return resolvedBinary
    }
  }
  catch {
    // fall through
  }
  resolvedBinary = null
  resolvedVersion = null
  return null
}

async function readVersion(): Promise<string | null> {
  await tesseractBinary()
  return resolvedVersion ?? null
}

function parseTsv(tsv: string): OcrRegion[] {
  const lines = tsv.split(/\r?\n/).filter(line => line.trim())
  if (!lines.length) return []

  let textIdx = 11
  let confIdx = 10
  let leftIdx = 6
  let topIdx = 7
  let widthIdx = 8
  let heightIdx = 9
  let start = 0

  if (/^level\t/i.test(lines[0]!)) {
    const header = lines[0]!.split('\t').map(h => h.trim().toLowerCase())
    const indexOf = (name: string, fallback: number) => {
      const found = header.indexOf(name)
      return found >= 0 ? found : fallback
    }
    textIdx = indexOf('text', 11)
    confIdx = indexOf('conf', 10)
    leftIdx = indexOf('left', 6)
    topIdx = indexOf('top', 7)
    widthIdx = indexOf('width', 8)
    heightIdx = indexOf('height', 9)
    start = 1
  }

  const regions: OcrRegion[] = []
  for (const line of lines.slice(start)) {
    const cols = line.split('\t')
    if (cols.length <= Math.max(textIdx, confIdx)) continue
    const level = Number(cols[0])
    if (level !== 5) continue
    const text = (cols[textIdx] ?? '').trim()
    if (!text || (/^\d+$/.test(text) && text.length > 8)) continue
    const conf = Number(cols[confIdx])
    regions.push({
      text,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf / 100)) : 0,
      box: [
        Number(cols[leftIdx]) || 0,
        Number(cols[topIdx]) || 0,
        Number(cols[widthIdx]) || 0,
        Number(cols[heightIdx]) || 0,
      ],
    })
  }
  return regions
}

function wordsFromPass(txt: string, tsv: string): { text: string, regions: OcrRegion[] } {
  const regions = parseTsv(tsv)
  const fromWords = regions.map(r => r.text).filter(Boolean).join(' ')
  const fromTxt = isTesseractTsv(txt) ? '' : txt.trim()
  return { text: fromWords || fromTxt, regions }
}

async function ocrFile(
  imagePath: string,
  psm: number,
  tessdataDir: string | null,
  outDir: string,
): Promise<{ text: string, regions: OcrRegion[] }> {
  const binary = await tesseractBinary()
  if (!binary) throw new Error('tesseract is not installed')

  // Write to files in the temp dir. `stdout` as outputbase is unreliable:
  // some Tesseract builds emit nothing (or a leftover stdout.tsv) so every
  // photo appears to say the same empty/garbage string.
  const outBase = join(outDir, `p${psm}`)
  const args = [
    imagePath, outBase,
    '--psm', String(psm),
    '-l', 'eng',
    '-c', `tessedit_char_whitelist=${WHITELIST}`,
    '-c', 'load_system_dawg=0',
    '-c', 'load_freq_dawg=0',
    'txt',
    'tsv',
  ]
  if (tessdataDir) {
    args.splice(2, 0, '--tessdata-dir', tessdataDir)
  }

  const result = await runCommand(binary, args)
  const txt = await readFile(`${outBase}.txt`, 'utf8').catch(() => '')
  const tsv = await readFile(`${outBase}.tsv`, 'utf8').catch(() => '')
  if (result.code !== 0 && !txt.trim() && !tsv.trim()) {
    throw new Error(result.stderr.trim() || `tesseract exited ${result.code}`)
  }

  return wordsFromPass(txt, tsv)
}

class SafecontainOcrService implements OcrService {
  async recognizeSceneText(image: Buffer, options?: { profile?: 'container' | 'chassis' | 'seal' }): Promise<SceneTextResult> {
    const started = Date.now()
    const profile = options?.profile ?? 'container'
    const version = await readVersion()

    if (!image.length) {
      return {
        available: false,
        engine: ENGINE,
        engineVersion: version,
        modelName: null,
        preprocessingProfile: profile,
        regions: [],
        candidates: [],
        rawText: '',
        latencyMs: Date.now() - started,
        message: 'No photo was captured. Take a picture of the number, or pick one from the library.',
      }
    }

    if (!await tesseractBinary()) {
      return {
        available: false,
        engine: ENGINE,
        engineVersion: null,
        modelName: null,
        preprocessingProfile: profile,
        regions: [],
        candidates: [],
        rawText: '',
        latencyMs: Date.now() - started,
        message: 'Tesseract is not installed, so SAFEContain cannot read the number. Enter it manually.',
      }
    }

    const tessdataDir = await ensureSafecontainTessdata()
    const dir = await mkdtemp(join(tmpdir(), 'ocr-'))
    const imagePath = join(dir, `frame.${imageExtension(image)}`)

    try {
      await writeFile(imagePath, image)
      const tessdataPasses: Array<string | null> = tessdataDir ? [tessdataDir, null] : [null]
      const texts: string[] = []
      let regions: OcrRegion[] = []

      for (const [index, dataDir] of tessdataPasses.entries()) {
        const passDir = join(dir, `pass-${index}`)
        await mkdir(passDir, { recursive: true })
        const psms = profile === 'container' ? [7, 6, 11] : [7, 6, 11]
        for (const psm of psms) {
          try {
            const pass = await ocrFile(imagePath, psm, dataDir, passDir)
            if (pass.text.trim() && !isTesseractTsv(pass.text)) texts.push(pass.text)
            if (pass.regions.length > regions.length) regions = pass.regions
          }
          catch (error) {
            console.warn(`[ocr] SAFEContain psm ${psm} failed:`, error instanceof Error ? error.message : error)
          }
        }
        if (profile === 'container' && /[A-Z]{4}/.test(texts.join(''))) break
      }

      const rawText = visibleOcrTranscript(texts.join(' '))
      const meanConf = regions.length
        ? regions.reduce((sum, r) => sum + r.confidence, 0) / regions.length
        : 0.65

      const candidates = parseEquipmentReadings(texts, profile, meanConf)

      return {
        available: true,
        engine: ENGINE,
        engineVersion: version,
        modelName: tessdataDir ? 'safecontain-eng' : 'eng',
        preprocessingProfile: profile,
        regions,
        candidates,
        rawText,
        latencyMs: Date.now() - started,
        message: candidates.length
          ? undefined
          : 'No container number could be read. Frame the four letters and seven digits, or type it.',
      }
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  async recognizeDocument(): Promise<DocumentOcrResult> {
    const version = await readVersion()
    return {
      available: Boolean(await tesseractBinary()),
      engine: ENGINE,
      engineVersion: version,
      text: '',
      fields: {},
      latencyMs: 0,
      message: 'Document field parsing is not enabled. Scene-text reading for container and chassis numbers is.',
    }
  }

  async healthCheck(): Promise<OcrHealth> {
    const version = await readVersion()
    if (!version) {
      return {
        healthy: false,
        engine: ENGINE,
        engineVersion: null,
        message: 'Tesseract is not installed, so SAFEContain cannot run.',
      }
    }
    const ready = await tessdataReady()
    return {
      healthy: true,
      engine: ENGINE,
      engineVersion: version,
      message: ready
        ? `SAFEContain ready (Tesseract ${version}).`
        : `Tesseract ${version} ready. SAFEContain tessdata downloads on the first scan.`,
    }
  }

  async engineVersion(): Promise<string | null> {
    return readVersion()
  }
}

let instance: OcrService | undefined

/** Resolve the configured engine. Swap the implementation here, nowhere else. */
export function useOcrService(): OcrService {
  if (!instance) instance = new SafecontainOcrService()
  return instance
}

/**
 * Confidence banding applied on top of raw engine scores (spec 30.6).
 *
 * `HIGH` auto-fills the field but still requires one confirming tap; nothing
 * that fails check-digit validation is ever silently accepted.
 */
export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW'

export function confidenceBand(candidate: OcrCandidate): ConfidenceBand {
  if (candidate.checkDigitValid && candidate.confidence >= 0.9) return 'HIGH'
  if (candidate.checkDigitValid || candidate.confidence >= 0.75) return 'MEDIUM'
  return 'LOW'
}

/**
 * Rank raw engine candidates using structure, check-digit validity and score,
 * then expand low-confidence readings into deterministic ISO-valid alternatives.
 *
 * Runs entirely locally — no external lookup is required to validate a number.
 */
export function rankCandidates(candidates: OcrCandidate[]): OcrCandidate[] {
  const expanded: OcrCandidate[] = [...candidates]

  for (const candidate of candidates) {
    if (candidate.checkDigitValid) continue
    for (const alternative of generateCorrectionCandidates(candidate.value, candidate.lowConfidenceIndexes)) {
      expanded.push({
        value: alternative,
        confidence: candidate.confidence * 0.8,
        checkDigitValid: true,
        lowConfidenceIndexes: candidate.lowConfidenceIndexes,
        box: candidate.box,
      })
    }
  }

  const seen = new Set<string>()
  return expanded
    .filter((c) => {
      if (seen.has(c.value)) return false
      seen.add(c.value)
      return true
    })
    .map(c => ({ ...c, checkDigitValid: validateContainerNumber(c.value).checkDigitValid }))
    .sort((a, b) => {
      if (a.checkDigitValid !== b.checkDigitValid) return a.checkDigitValid ? -1 : 1
      return b.confidence - a.confidence
    })
}
