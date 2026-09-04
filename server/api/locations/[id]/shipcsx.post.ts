import { eq } from 'drizzle-orm'
import { locations } from '../../../database/schema'
import { assertTenant, requireAuth } from '../../../utils/session'
import { checkShipcsxForItems, listCustomerBoxesForShipcsx } from '../../../services/shipcsx-poll'
import { latestSnapshotsForContainers } from '../../../services/csx-releases'

/** Manual ShipCSX lookup for every customer box sitting at this location. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })

  const db = useDb()
  const [location] = await db.select().from(locations).where(eq(locations.id, id)).limit(1)
  assertTenant(auth, location, 'Location')
  if (location!.type !== 'CUSTOMER') {
    throw createError({ statusCode: 409, statusMessage: 'Waybill checks run for containers at customer locations.' })
  }

  const items = await listCustomerBoxesForShipcsx(db, auth.companyId, id)
  const saved = await checkShipcsxForItems(db, auth.companyId, items)
  const latest = await latestSnapshotsForContainers(db, auth.companyId, items.map(item => item.containerId))
  return { ok: true, checked: saved.length, snapshots: latest }
})
