import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { yardSlots } from '../../../database/schema'
import { assertTenant, requireAuth } from '../../../utils/session'

const schema = z.object({
  x: z.number(),
  y: z.number(),
  rotation: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
})

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Slot id is required.' })
  if (auth.role !== 'ADMIN') {
    throw createError({ statusCode: 403, statusMessage: 'Administrator access required.' })
  }
  const body = await readValidatedJson(event, schema)
  const db = useDb()
  const [slot] = await db.select().from(yardSlots).where(eq(yardSlots.id, id)).limit(1)
  assertTenant(auth, slot, 'Yard slot')
  const [updated] = await db.update(yardSlots).set({
    x: body.x,
    y: body.y,
    ...(body.rotation != null ? { rotation: body.rotation } : {}),
    ...(body.width != null ? { width: body.width } : {}),
    ...(body.height != null ? { height: body.height } : {}),
    manuallyModified: true,
  }).where(and(eq(yardSlots.id, id), eq(yardSlots.companyId, auth.companyId))).returning()
  return { ok: true, slot: updated }
})
