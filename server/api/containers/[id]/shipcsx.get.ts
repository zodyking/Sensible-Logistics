import { eq } from 'drizzle-orm'
import { containers } from '../../../database/schema'
import { assertTenant, requireAuth } from '../../../utils/session'
import { latestSnapshotsForContainers } from '../../../services/csx-releases'
import { getShipcsxCheckJob } from '../../../services/shipcsx-jobs'

/** Live ShipCSX check progress plus the latest stored snapshot. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Container id is required.' })

  const db = useDb()
  const [container] = await db.select().from(containers).where(eq(containers.id, id)).limit(1)
  assertTenant(auth, container, 'Container')

  const [snapshot] = await latestSnapshotsForContainers(db, auth.companyId, [id])
  return {
    check: getShipcsxCheckJob(id),
    snapshot: snapshot ?? null,
  }
})
