import { z } from 'zod'
import { confidenceBand, rankCandidates, useOcrService } from '../../services/ocr'
import { requireDriver } from '../../utils/session'
import { validateContainerNumber } from '#shared/utils/iso6346'
import { visibleOcrTranscript } from '#shared/utils/ocr-parse'

const dataUrl = z.string().min(32, 'Take a photo first.').max(20_000_000)

const schema = z.object({
  /** JPEG/PNG data URL from a full-frame photo (camera or library). */
  image: dataUrl.optional(),
  /** Extra frames (for example a 90° rotation) of the same photo. */
  images: z.array(dataUrl).min(1).max(4).optional(),
}).refine(body => Boolean(body.image || body.images?.length), {
  message: 'Take a photo first.',
})

function toBuffer(dataUrlValue: string): Buffer {
  return Buffer.from(dataUrlValue.replace(/^data:[^;]+;base64,/, ''), 'base64')
}

/**
 * Scene-text recognition for a single equipment photo.
 *
 * One frame should contain both the ISO container marking and the chassis
 * plate. Returns both readings plus ranked container candidates — never a
 * single magic string (spec 34).
 */
export default defineEventHandler(async (event) => {
  await requireDriver(event)
  const body = await readValidatedJson(event, schema)

  const frames = body.images?.length ? body.images : [body.image!]
  const ocr = useOcrService()

  const mergedTexts: string[] = []
  const allCandidates: ReturnType<typeof rankCandidates> = []
  let available = false
  let engine = 'openocr'
  let engineVersion: string | null = null
  let latencyMs = 0
  let message: string | undefined
  let container: string | null = null
  let chassis: string | null = null

  for (const frame of frames) {
    const buffer = toBuffer(frame)
    if (!buffer.length) continue
    const result = await ocr.recognizeSceneText(buffer)
    latencyMs += result.latencyMs
    engine = result.engine
    engineVersion = result.engineVersion
    available = available || result.available
    if (result.rawText) mergedTexts.push(result.rawText)
    allCandidates.push(...rankCandidates(result.candidates))
    if (!container && result.container) container = result.container
    if (!chassis && result.chassis) chassis = result.chassis
    if (!message && result.message) message = result.message
    if (container && chassis) break
  }

  const seen = new Set<string>()
  const candidates = allCandidates
    .filter((candidate) => {
      if (seen.has(candidate.value)) return false
      seen.add(candidate.value)
      return true
    })
    .sort((a, b) => {
      if (a.checkDigitValid !== b.checkDigitValid) return a.checkDigitValid ? -1 : 1
      return b.confidence - a.confidence
    })
    .map(candidate => ({
      ...candidate,
      band: confidenceBand(candidate),
      validation: validateContainerNumber(candidate.value),
    }))

  if (!container) container = candidates[0]?.value ?? null

  const rawText = visibleOcrTranscript(mergedTexts.join(' '))

  return {
    available,
    engine,
    engineVersion,
    rawText,
    regions: [],
    container,
    chassis,
    candidates,
    latencyMs,
    message: container
      ? undefined
      : (message || 'No container number could be read. Frame the four letters and seven digits, then retake.'),
    fallback: {
      manualEntry: true,
      note: 'OCR accelerates the workflow but never blocks it — you can edit both numbers.',
    },
  }
})
