import { z } from 'zod'
import { assertTerminusLocation, createCsxReleases } from '../../../services/csx-releases'
import { requireAuth } from '../../../utils/session'

const schema = z.object({
  source: z.enum(['MANUAL', 'OCR']).default('MANUAL'),
  rows: z.array(z.object({
    containerNumber: z.string().trim().min(4),
    pickupNumber: z.string().trim().min(1),
  })).min(1, 'Add at least one container and pickup number.'),
})

/** Save a reviewed CSX empty-pickup list for this marine/rail site. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })

  const body = await readValidatedJson(event, schema)
  const db = useDb()
  await assertTerminusLocation(db, auth.companyId, id)
  const releases = await createCsxReleases(db, {
    companyId: auth.companyId,
    locationId: id,
    rows: body.rows.map(row => ({ ...row, source: body.source })),
  })
  return { ok: true, releases }
})
