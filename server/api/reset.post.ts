import { z } from 'zod'
import { RESET_TARGET_IDS } from '#shared/utils/reset-targets'
import { clearResetTarget, loadResetCounts } from '../services/data-reset'

const schema = z.object({
  target: z.enum(RESET_TARGET_IDS),
})

export default defineEventHandler(async (event) => {
  const auth = await requireUnlockedFeature(event, 'RESET')
  const body = await readValidatedJson(event, schema)
  const db = useDb()
  const result = await clearResetTarget(db, {
    companyId: auth.companyId,
    keepUserId: auth.userId,
    target: body.target,
  })
  const counts = await loadResetCounts(db, auth.companyId, auth.userId)
  return { ok: true, deleted: result.deleted, counts }
})
