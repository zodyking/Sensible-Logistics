import { z } from 'zod'
import { loadMapContext } from '../../services/osm-map'
import { requireAuth } from '../../utils/session'
import { isValidBbox } from '#shared/utils/geo'

const querySchema = z.object({
  west: z.coerce.number(),
  south: z.coerce.number(),
  east: z.coerce.number(),
  north: z.coerce.number(),
})

/** OSM streets/sidewalks plus a Panoramax street-level still, when one exists. */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)
  const box = { west: query.west, south: query.south, east: query.east, north: query.north }
  if (!isValidBbox(box)) {
    throw createError({ statusCode: 422, statusMessage: 'The map boundary is not a valid box.' })
  }
  return loadMapContext(box)
})
