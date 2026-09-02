import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { yardFeatures, yardLayouts, type GeoJsonGeometry } from '../../../../database/schema'
import { assertTenant, requireAuth } from '../../../../utils/session'
import { geometryToGeo, type YardLayoutOrigin } from '#shared/utils/yard-plan'

const schema = z.object({
  localGeometry: z.object({
    type: z.enum(['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']),
    coordinates: z.any(),
  }),
})

/** Manual correction. Regen will not overwrite this feature. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Feature id is required.' })
  if (auth.role !== 'ADMIN') {
    throw createError({ statusCode: 403, statusMessage: 'Administrator access required.' })
  }
  const body = await readValidatedJson(event, schema)
  const db = useDb()
  const [feature] = await db.select().from(yardFeatures).where(eq(yardFeatures.id, id)).limit(1)
  assertTenant(auth, feature, 'Yard feature')

  const [layout] = await db.select().from(yardLayouts).where(eq(yardLayouts.id, feature!.layoutId)).limit(1)
  const origin: YardLayoutOrigin = {
    originLng: layout?.originLng ?? 0,
    originLat: layout?.originLat ?? 0,
    planeWidth: layout?.planeWidth ?? 1,
    planeHeight: layout?.planeHeight ?? 1,
    rotationDeg: layout?.rotationDeg ?? 0,
  }
  const localGeometry = body.localGeometry as GeoJsonGeometry
  const [updated] = await db.update(yardFeatures).set({
    localGeometry,
    geoGeometry: geometryToGeo(localGeometry, origin) as GeoJsonGeometry,
    source: 'MANUAL',
    manuallyModified: true,
    updatedAt: new Date(),
  }).where(and(eq(yardFeatures.id, id), eq(yardFeatures.companyId, auth.companyId))).returning()

  return { ok: true, feature: updated }
})
