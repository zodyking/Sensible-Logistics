import { assertTerminusLocation, cancelCsxRelease } from '../../../../services/csx-releases'
import { requireAuth } from '../../../../utils/session'

/** Cancel an open or claimed CSX pickup release. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  const releaseId = getRouterParam(event, 'releaseId')
  if (!id || !releaseId) throw createError({ statusCode: 400, statusMessage: 'Release id is required.' })

  const db = useDb()
  await assertTerminusLocation(db, auth.companyId, id)
  const release = await cancelCsxRelease(db, auth.companyId, releaseId)
  if (!release) throw createError({ statusCode: 404, statusMessage: 'Release not found.' })
  return { ok: true, release }
})
