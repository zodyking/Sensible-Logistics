import { eq } from 'drizzle-orm'
import { containers } from '../../../database/schema'
import { assertTenant, requireAuth } from '../../../utils/session'
import { checkShipcsxForItems, resolveShipcsxTerminal } from '../../../services/shipcsx-poll'
import { latestSnapshotsForContainers } from '../../../services/csx-releases'
import { normalizeContainerNumber } from '#shared/utils/iso6346'
import { shipcsxPublicError } from '#shared/utils/shipcsx-status'

/** Manual ShipCSX lookup for one container. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Container id is required.' })

  const db = useDb()
  const [container] = await db.select().from(containers).where(eq(containers.id, id)).limit(1)
  assertTenant(auth, container, 'Container')

  try {
    const terminal = await resolveShipcsxTerminal(db, auth.companyId, id)
    const saved = await checkShipcsxForItems(db, auth.companyId, [{
      containerId: id,
      equipmentNumber: container!.numberNormalized || normalizeContainerNumber(container!.number),
      terminal,
    }])
    const [latest] = await latestSnapshotsForContainers(db, auth.companyId, [id])
    return { ok: true, snapshot: latest ?? saved[0] ?? null }
  }
  catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: shipcsxPublicError(error instanceof Error ? error.message : ''),
    })
  }
})
