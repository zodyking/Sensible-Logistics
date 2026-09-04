import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { containers } from '../../../database/schema'
import { assertTenant, requireAuth } from '../../../utils/session'
import { checkShipcsxForItems } from '../../../services/shipcsx-poll'
import { beginShipcsxCheckJob, finishShipcsxCheckJob, getShipcsxCheckJob, setShipcsxCheckStep } from '../../../services/shipcsx-jobs'
import { normalizeContainerNumber } from '#shared/utils/iso6346'
import { SHIPCSX_REFERENCE, shipcsxEquipmentParts } from '#shared/utils/csx-lookup'
import { shipcsxPublicError } from '#shared/utils/shipcsx-status'

const schema = z.object({
  terminal: z.string().trim().min(1, 'Choose a CSX location.').max(120),
  equipmentNumber: z.string().trim().min(4).max(20),
  reference: z.string().trim().max(40).optional(),
})

/** Start a ShipCSX lookup. Returns immediately; the container page polls progress. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Container id is required.' })

  const body = await readValidatedJson(event, schema)
  const parts = shipcsxEquipmentParts(body.equipmentNumber)
  if (!parts) {
    throw createError({ statusCode: 422, statusMessage: 'Enter a trailer initial and number.' })
  }

  const db = useDb()
  const [container] = await db.select().from(containers).where(eq(containers.id, id)).limit(1)
  assertTenant(auth, container, 'Container')

  const running = getShipcsxCheckJob(id)
  if (running?.status === 'running') {
    return { ok: true, started: true, check: running }
  }

  const equipmentNumber = normalizeContainerNumber(body.equipmentNumber)
  const reference = body.reference?.trim() || SHIPCSX_REFERENCE
  const job = beginShipcsxCheckJob(id)

  void Promise.resolve().then(async () => {
    try {
      await checkShipcsxForItems(db, auth.companyId, [{
        containerId: id,
        equipmentNumber,
        terminal: body.terminal,
      }], {
        reference,
        onStep: step => setShipcsxCheckStep(id, step),
      })
      finishShipcsxCheckJob(id)
    }
    catch (error) {
      finishShipcsxCheckJob(id, shipcsxPublicError(error instanceof Error ? error.message : ''))
    }
  })

  return { ok: true, started: true, check: job }
})
