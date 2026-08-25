import { generateCorrectionCandidates, validateContainerNumber } from '#shared/utils/iso6346'

/**
 * Local OCR engine boundary (spec 30.7, 34).
 *
 * The engine interface is defined *before* any model-specific inference code so
 * the PaddleOCR service can be swapped or upgraded without touching workflow
 * code. Inference never runs inside Nuxt or the browser — it lives in a separate
 * container reached over this internal contract.
 *
 * Phase 1 ships {@link NotImplementedOcrService}, which degrades gracefully to
 * the manual-entry path. OCR accelerates the workflow but must never block it.
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

const ENGINE = 'paddleocr'

/**
 * Phase 1 implementation. Reports `available: false` rather than throwing, so
 * the Scan screen can fall back to manual entry without an error state.
 *
 * TODO(Phase 2): replace with `HttpOcrService` posting to
 * `NUXT_OCR_SERVICE_URL` (Dockerised PaddleOCR PP-OCRv6 Medium + OpenCV).
 * Preserve this interface exactly so no workflow code changes.
 */
export class NotImplementedOcrService implements OcrService {
  async recognizeSceneText(): Promise<SceneTextResult> {
    return {
      available: false,
      engine: ENGINE,
      engineVersion: null,
      modelName: null,
      preprocessingProfile: null,
      regions: [],
      candidates: [],
      latencyMs: 0,
      message: 'The OCR service is not deployed yet. Enter the number manually — validation still applies.',
    }
  }

  async recognizeDocument(): Promise<DocumentOcrResult> {
    return {
      available: false,
      engine: ENGINE,
      engineVersion: null,
      text: '',
      fields: {},
      latencyMs: 0,
      message: 'Document parsing runs asynchronously once the PP-StructureV3 service is deployed.',
    }
  }

  async healthCheck(): Promise<OcrHealth> {
    return {
      healthy: false,
      engine: ENGINE,
      engineVersion: null,
      message: 'Not configured. Set NUXT_OCR_SERVICE_URL and deploy the PaddleOCR container.',
    }
  }

  async engineVersion(): Promise<string | null> {
    return null
  }
}

let instance: OcrService | undefined

/** Resolve the configured engine. Swap the implementation here, nowhere else. */
export function useOcrService(): OcrService {
  if (!instance) instance = new NotImplementedOcrService()
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
        // Corrected readings are ranked below what the engine actually saw.
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
