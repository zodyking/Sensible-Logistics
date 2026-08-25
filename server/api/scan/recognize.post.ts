import { z } from 'zod'
import { confidenceBand, rankCandidates, useOcrService } from '../../services/ocr'
import { requireDriver } from '../../utils/session'
import { hasIsoEquipmentCategory, validateContainerNumber } from '#shared/utils/iso6346'

const schema = z.object({
  /** JPEG/PNG data URL from the framed camera crop. */
  image: z.string().min(32, 'Capture a frame from the camera first.').max(20_000_000),
  profile: z.enum(['container', 'chassis', 'seal']).default('container'),
})

/**
 * Scene-text recognition for equipment photos.
 *
 * Returns candidate values and regions, never a single magic string (spec 34).
 * Container crops are expected to already be rotated into a left-to-right line;
 * chassis crops stay horizontal.
 */
export default defineEventHandler(async (event) => {
  await requireDriver(event)
  const body = await readValidatedJson(event, schema)

  const ocr = useOcrService()
  const buffer = Buffer.from(body.image.replace(/^data:[^;]+;base64,/, ''), 'base64')
  const result = await ocr.recognizeSceneText(buffer, { profile: body.profile })

  const ranked = rankCandidates(result.candidates).filter((candidate) => {
    if (body.profile === 'container') return hasIsoEquipmentCategory(candidate.value)
    return /\d/.test(candidate.value)
  })

  const candidates = ranked.map(candidate => ({
    ...candidate,
    band: confidenceBand(candidate),
    validation: validateContainerNumber(candidate.value),
  }))

  return {
    available: result.available,
    engine: result.engine,
    engineVersion: result.engineVersion,
    regions: result.regions,
    candidates,
    latencyMs: result.latencyMs,
    message: result.message,
    fallback: {
      manualEntry: true,
      note: 'OCR accelerates the workflow but never blocks it — enter the number by hand.',
    },
  }
})
