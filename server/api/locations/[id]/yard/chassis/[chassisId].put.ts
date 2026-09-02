import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { chassis, yardAssetPositions, yardLayouts } from '../../../../../database/schema'
import { assertTenant, requireAuth } from '../../../../../utils/session'

const schema = z.object({
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  slotId: z.string().uuid().nullish(),
})

/** Save a bare chassis position on the generated yard plane. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const locationId = getRouterParam(event, 'id')
  const chassisId = getRouterParam(event, 'chassisId')
  if (!locationId || !chassisId) {
    throw createError({ statusCode: 400, statusMessage: 'Location and chassis ids are required.' })
  }
  const body = await readValidatedJson(event, schema)
  const db = useDb()

  const [item] = await db.select().from(chassis).where(eq(chassis.id, chassisId)).limit(1)
  assertTenant(auth, item, 'Chassis')
  if (item!.currentLocationId !== locationId || item!.currentContainerId) {
    throw createError({ statusCode: 409, statusMessage: 'That chassis is not parked bare at this location.' })
  }

  const [layout] = await db.select().from(yardLayouts).where(and(
    eq(yardLayouts.locationId, locationId),
    eq(yardLayouts.companyId, auth.companyId),
    eq(yardLayouts.isCurrent, true),
  )).limit(1)
  if (!layout || layout.status !== 'READY') {
    throw createError({ statusCode: 409, statusMessage: 'Generate a yard plan before placing chassis.' })
  }

  const [existing] = await db.select().from(yardAssetPositions).where(and(
    eq(yardAssetPositions.layoutId, layout.id),
    eq(yardAssetPositions.assetType, 'CHASSIS'),
    eq(yardAssetPositions.assetId, chassisId),
  )).limit(1)

  const values = {
    x: body.x,
    y: body.y,
    rotation: body.rotation,
    slotId: body.slotId ?? null,
    updatedAt: new Date(),
  }

  if (existing) {
    const [updated] = await db.update(yardAssetPositions).set(values)
      .where(eq(yardAssetPositions.id, existing.id)).returning()
    return { ok: true, position: updated }
  }

  const [created] = await db.insert(yardAssetPositions).values({
    companyId: auth.companyId,
    layoutId: layout.id,
    assetType: 'CHASSIS',
    assetId: chassisId,
    ...values,
  }).returning()
  return { ok: true, position: created }
})
