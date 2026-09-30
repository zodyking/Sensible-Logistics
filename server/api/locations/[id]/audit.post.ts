import { z } from 'zod'
import { runLocationAudit } from '../../../services/location-audit'
import { requireAuth } from '../../../utils/session'
import { CONTAINER_TYPES, PICKUP_EQUIPMENT_SIZES } from '#shared/utils/domain'
import { LOCATION_AUDIT_MAX } from '#shared/utils/location-audit'

const schema = z.object({
  action: z.enum(['add', 'move', 'delete']),
  containerNumbers: z.array(z.string().trim().min(1).max(40)).max(LOCATION_AUDIT_MAX).optional(),
  containerType: z.enum(CONTAINER_TYPES).optional(),
  equipmentType: z.enum(PICKUP_EQUIPMENT_SIZES).optional(),
  containerIds: z.array(z.string().uuid()).max(LOCATION_AUDIT_MAX).optional(),
  destinationLocationId: z.string().uuid().optional(),
}).superRefine((body, ctx) => {
  if (body.action === 'add') {
    if (!body.containerNumbers?.length) {
      ctx.addIssue({ code: 'custom', message: 'Paste at least one container number.', path: ['containerNumbers'] })
    }
    if (!body.containerType) {
      ctx.addIssue({ code: 'custom', message: 'Select a container type.', path: ['containerType'] })
    }
    if (!body.equipmentType) {
      ctx.addIssue({ code: 'custom', message: 'Select a container size.', path: ['equipmentType'] })
    }
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

/** Bulk add, move, or delete containers at this location for a yard audit. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const locationId = getRouterParam(event, 'id')
  if (!locationId) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }
  const body = await readValidatedJson(event, schema)
  return runLocationAudit(useDb(), auth, { ...body, locationId })
})
