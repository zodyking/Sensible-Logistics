import { z } from 'zod'
import { featureIdForCode, toggleFeature } from '../../../shared/utils/feature-codes'
import { readUnlockedFeatures, setUnlockedFeatures } from '../../utils/session'

const schema = z.object({
  code: z.string().trim().min(1, 'Enter a code.').max(40),
})

export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const body = await readValidatedJson(event, schema)
  const id = featureIdForCode(body.code)

  if (!id) {
    throw createError({ statusCode: 422, statusMessage: 'That code did not match.' })
  }

  const session = await getUserSession(event)
  const result = toggleFeature(readUnlockedFeatures(session), id)
  await setUnlockedFeatures(event, result.unlocked)

  return {
    id,
    enabled: result.enabled,
    unlocked: result.unlocked,
  }
})
