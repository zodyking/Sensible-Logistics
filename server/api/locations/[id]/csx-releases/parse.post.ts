import { z } from 'zod'
import { assertTerminusLocation } from '../../../../services/csx-releases'
import { useOcrService } from '../../../../services/ocr'
import { requireAuth } from '../../../../utils/session'
import { parseCsxPickupList } from '#shared/utils/csx-list-parse'

const dataUrl = z.string().min(32).max(20_000_000)

const schema = z.object({
  image: dataUrl.optional(),
  images: z.array(dataUrl).min(1).max(4).optional(),
  text: z.string().trim().max(20_000).optional(),
}).refine(body => Boolean(body.image || body.images?.length || body.text), {
  message: 'Take a photo or paste the list first.',
})

function toBuffer(value: string): Buffer {
  return Buffer.from(value.replace(/^data:[^;]+;base64,/, ''), 'base64')
}

/** OCR a release list and return proposed container / pickup pairs for review. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })

  const body = await readValidatedJson(event, schema)
  await assertTerminusLocation(useDb(), auth.companyId, id)

  const lines: Array<{ text: string }> = []
  if (body.text) {
    for (const line of body.text.split(/\r?\n/)) {
      if (line.trim()) lines.push({ text: line })
    }
  }

  const frames = body.images?.length ? body.images : (body.image ? [body.image] : [])
  const ocr = useOcrService()
  for (const frame of frames) {
    const result = await ocr.recognizeSceneText(toBuffer(frame))
    if (result.regions.length) {
      for (const region of result.regions) {
        if (region.text.trim()) lines.push({ text: region.text })
      }
    }
    else if (result.rawText) {
      for (const line of result.rawText.split(/\s{2,}|\n/)) {
        if (line.trim()) lines.push({ text: line })
      }
    }
  }

  return parseCsxPickupList(lines)
})
