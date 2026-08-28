import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { locations } from '../../database/schema'
import { assertTenant, requireAuth } from '../../utils/session'
import { normalizeHeading } from '#shared/utils/geo'

const schema = z.object({
  mapHeading: z.coerce.number(),
})

/** Persist the yard map rotation so streets stay square on the next visit. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  const db = useDb()
  const [location] = await db.select().from(locations).where(eq(locations.id, id)).limit(1)
  assertTenant(auth, location, 'Location')

  const [updated] = await db
    .update(locations)
    .set({
      mapHeading: normalizeHeading(body.mapHeading),
      updatedAt: new Date(),
    })
    .where(eq(locations.id, id))
    .returning()

  return {
    ok: true,
    location: {
      id: updated!.id,
      mapHeading: updated!.mapHeading ?? 0,
    },
  }
})
