import { classifyEquipmentReadings, driverOcrMessage, visibleOcrTranscript } from '#shared/utils/ocr-parse'
import { generateCorrectionCandidates, validateContainerNumber } from '#shared/utils/iso6346'
import { OPENOCR_ENGINE, OPENOCR_PIPELINE, useOpenOcrWorker } from './openocr'

/**
 * Local OCR engine boundary (spec 30.7, 34).
 *
 * Inference never runs in the browser. Scene-text reading uses OpenOCR's
 * mobile ONNX pipeline (RepViT DB detector + RepSVTR Mobile recognizer)
 * on CPU. Models load once in a persistent Python worker.
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
  container: string | null
  chassis: string | null
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
  recognizeSceneText(image: Buffer, options?: { profile?: 'container' | 'chassis' | 'seal' | 'equipment' }): Promise<SceneTextResult>
  recognizeDocument(file: Buffer, options?: { mimeType?: string }): Promise<DocumentOcrResult>
  healthCheck(): Promise<OcrHealth>
  engineVersion(): Promise<string | null>
}

const ENGINE = OPENOCR_ENGINE

class OpenOcrService implements OcrService {
  async recognizeSceneText(image: Buffer): Promise<SceneTextResult> {
    const started = Date.now()
    const worker = useOpenOcrWorker()

    if (!image.length) {
      return {
        available: false,
        engine: ENGINE,
        engineVersion: null,
        modelName: OPENOCR_PIPELINE,
        preprocessingProfile: 'equipment',
        regions: [],
        candidates: [],
        rawText: '',
        latencyMs: Date.now() - started,
        container: null,
        chassis: null,
        message: 'No photo was captured. Take a picture of the container and chassis numbers.',
      }
    }

    try {
      const result = await worker.recognize(image)
      const texts = result.lines.map(line => line.text)
      const meanConf = result.lines.length
        ? result.lines.reduce((sum, line) => sum + (Number(line.score) || 0), 0) / result.lines.length
        : 0.7
      const classified = classifyEquipmentReadings(texts, meanConf)
      const rawText = visibleOcrTranscript(texts.join(' '))
      const regions: OcrRegion[] = result.lines.map(line => ({
        text: line.text,
        confidence: Number(line.score) || 0,
        box: [0, 0, 0, 0],
      }))

      return {
        available: result.ok,
        engine: result.engine || ENGINE,
        engineVersion: result.engineVersion,
        modelName: OPENOCR_PIPELINE,
        preprocessingProfile: 'equipment',
        regions,
        candidates: classified.containerCandidates,
        rawText,
        latencyMs: Date.now() - started,
        container: classified.container,
        chassis: classified.chassis,
        message: classified.container
          ? undefined
          : driverOcrMessage(result.error),
      }
    }
    catch (error) {
      return {
        available: false,
        engine: ENGINE,
        engineVersion: null,
        modelName: OPENOCR_PIPELINE,
        preprocessingProfile: 'equipment',
        regions: [],
        candidates: [],
        rawText: '',
        latencyMs: Date.now() - started,
        container: null,
        chassis: null,
        message: driverOcrMessage(
          error instanceof Error ? error.message : undefined,
          'OpenOCR could not read the photo. Type the numbers instead.',
        ),
      }
    }
  }

  async recognizeDocument(): Promise<DocumentOcrResult> {
    return {
      available: true,
      engine: ENGINE,
      engineVersion: null,
      text: '',
      fields: {},
      latencyMs: 0,
      message: 'Document field parsing is not enabled. Scene-text reading for container and chassis numbers is.',
    }
  }

  async healthCheck(): Promise<OcrHealth> {
    const worker = useOpenOcrWorker()
    const health = await worker.health()
    return {
      healthy: health.healthy,
      engine: ENGINE,
      engineVersion: health.version,
      message: health.message,
    }
  }

  async engineVersion(): Promise<string | null> {
    const health = await this.healthCheck()
    return health.engineVersion
  }
}

let instance: OcrService | undefined

/** Resolve the configured engine. Swap the implementation here, nowhere else. */
export function useOcrService(): OcrService {
  if (!instance) instance = new OpenOcrService()
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
