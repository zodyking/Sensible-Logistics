import { z } from 'zod'
import { confidenceBand, rankCandidates, useOcrService } from '../../services/ocr'
import { requireDriver } from '../../utils/session'
import { validateContainerNumber } from '#shared/utils/iso6346'

const schema = z.object({
  /** JPEG/PNG data URL from a full-frame photo (camera or library). */
  image: z.string().min(32, 'Take a photo first.').max(20_000_000),
  profile: z.enum(['container', 'chassis', 'seal']).default('container'),
})

/**
 * Scene-text recognition for equipment photos.
 *
 * Returns candidate values and regions, never a single magic string (spec 34).
 * Photos are full-frame; SAFEContain reads ISO 6346 container codes from the
 * whole image. Chassis uses the same capture path with a chassis profile.
 */
export default defineEventHandler(async (event) => {
  await requireDriver(event)
  const body = await readValidatedJson(event, schema)

  const ocr = useOcrService()
  const buffer = Buffer.from(body.image.replace(/^data:[^;]+;base64,/, ''), 'base64')
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
