import { z } from 'zod'
import { nearestStreetHeading } from '../../services/geocoding'
import { requireAuth } from '../../utils/session'
import { longestEdgeBearing, type GeoJsonPolygon } from '#shared/utils/geo'

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  west: z.coerce.number().optional(),
  south: z.coerce.number().optional(),
  east: z.coerce.number().optional(),
  north: z.coerce.number().optional(),
})

/** Street heading at a point so a dropped container can snap to the road. */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)
  const osm = await nearestStreetHeading(query.lat, query.lng)

  if (osm?.source === 'OSM') {
    return { heading: osm.heading, source: 'OSM' as const }
  }

  if (query.west != null && query.south != null && query.east != null && query.north != null) {
    const polygon: GeoJsonPolygon = {
      type: 'Polygon',
      coordinates: [[
        [query.west, query.south],
        [query.east, query.south],
        [query.east, query.north],
        [query.west, query.north],
        [query.west, query.south],
      ]],
    }
    const fallback = longestEdgeBearing(polygon)
    if (fallback != null) {
      return { heading: fallback, source: 'BOUNDARY' as const }
    }
  }

  return { heading: 0, source: 'NONE' as const, message: osm?.message }
})
