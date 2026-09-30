import { z } from 'zod'
import { runLocationAudit } from '../../../services/location-audit'
import { requireAuth } from '../../../utils/session'
import { CONTAINER_TYPES, PICKUP_EQUIPMENT_SIZES } from '#shared/utils/domain'
import { LOCATION_AUDIT_MAX } from '#shared/utils/location-audit'

const addItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('CONTAINER'),
    containerNumber: z.string().trim().min(1).max(40),
    chassisNumber: z.string().trim().max(40).optional().nullable(),
    containerType: z.enum(CONTAINER_TYPES),
    equipmentType: z.enum(PICKUP_EQUIPMENT_SIZES),
  }),
  z.object({
    kind: z.literal('BARE_CHASSIS'),
    chassisNumber: z.string().trim().min(1).max(40),
  }),
])

const schema = z.object({
  action: z.enum(['add', 'move', 'delete']),
  items: z.array(addItemSchema).max(LOCATION_AUDIT_MAX).optional(),
  containerIds: z.array(z.string().uuid()).max(LOCATION_AUDIT_MAX).optional(),
  destinationLocationId: z.string().uuid().optional(),
}).superRefine((body, ctx) => {
  if (body.action === 'add' && !body.items?.length) {
    ctx.addIssue({ code: 'custom', message: 'Add at least one container or chassis.', path: ['items'] })
  }
  if (body.action === 'move' || body.action === 'delete') {
    if (!body.containerIds?.length) {
      ctx.addIssue({ code: 'custom', message: 'Select at least one container.', path: ['containerIds'] })
    }
  }
  if (body.action === 'move' && !body.destinationLocationId) {
    ctx.addIssue({ code: 'custom', message: 'Pick a destination.', path: ['destinationLocationId'] })
  }
})

/** Bulk add, move, or delete equipment at this location for a yard audit. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const locationId = getRouterParam(event, 'id')
  if (!locationId) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }
  const body = await readValidatedJson(event, schema)
  return runLocationAudit(useDb(), auth, { ...body, locationId })
})
