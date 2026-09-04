import { z } from 'zod'
import { generateYardLayout } from '../../../../services/yard-generate'
import { requireAdmin } from '../../../../utils/session'
import { isPlausibleYardFence } from '#shared/utils/geo'

const schema = z.object({
  boundary: z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
  }),
})

/** Draw a fence, generate the 2D site plan, and persist it. */
export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event)
  const locationId = getRouterParam(event, 'id')
  if (!locationId) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }
  const body = await readValidatedJson(event, schema)
  if (!isPlausibleYardFence(body.boundary)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That zone is too large. Zoom in until the gold frame hugs the usable yard.',
    })
  }
  return generateYardLayout(useDb(), auth, { locationId, boundary: body.boundary })
})
