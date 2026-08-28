import { retireLocation } from '../../services/locations'
import { assertTenant, requireAuth } from '../../utils/session'
import { locations } from '../../database/schema'
import { eq } from 'drizzle-orm'

/** Soft-delete a location. On-site containers and chassis move to Uncategorized. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }

  const db = useDb()
  const [location] = await db.select().from(locations).where(eq(locations.id, id)).limit(1)
  assertTenant(auth, location, 'Location')

  const result = await retireLocation(db, auth.companyId, id)
  return { ok: true, ...result }
})
