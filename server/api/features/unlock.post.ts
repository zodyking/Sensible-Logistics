import { z } from 'zod'
import { featureIdForCode } from '#shared/utils/feature-codes'
import { toggleUnlockedFeature } from '../../services/features'
import { setUnlockedFeatures } from '../../utils/session'

const schema = z.object({
  code: z.string().trim().min(1, 'Enter a code.').max(40),
})

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const body = await readValidatedJson(event, schema)
  const id = featureIdForCode(body.code)

  if (!id) {
    throw createError({ statusCode: 422, statusMessage: 'That code did not match.' })
  }

  const result = await toggleUnlockedFeature(useDb(), auth.userId, id)
  await setUnlockedFeatures(event, result.unlocked)

  return {
    id,
    enabled: result.enabled,
    unlocked: result.unlocked,
  }
})
