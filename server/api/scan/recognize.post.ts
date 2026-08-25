import { z } from 'zod'
import { confidenceBand, rankCandidates, useOcrService } from '../../services/ocr'
import { requireDriver } from '../../utils/session'
import { validateContainerNumber } from '#shared/utils/iso6346'

const schema = z.object({
  /** Base64 data URL from the camera capture. Kept as evidence once storage lands. */
  image: z.string().min(1).max(20_000_000).optional(),
  profile: z.enum(['container', 'chassis', 'seal']).default('container'),
})

/**
 * Scene-text recognition for equipment photos.
 *
 * Returns candidate values and regions, never a single magic string (spec 34).
 * While the PaddleOCR service is undeployed this responds `available: false`
 * with a 200 so the Scan screen falls back to manual entry rather than erroring.
 */
export default defineEventHandler(async (event) => {
  await requireDriver(event)
  const body = await readValidatedJson(event, schema)

  const ocr = useOcrService()
  const buffer = body.image ? Buffer.from(body.image.replace(/^data:[^;]+;base64,/, ''), 'base64') : Buffer.alloc(0)
  const result = await ocr.recognizeSceneText(buffer, { profile: body.profile })

  const candidates = rankCandidates(result.candidates).map(candidate => ({
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
