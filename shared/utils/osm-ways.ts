/**
 * OpenStreetMap highway classification used by the location fence and 2D yard.
 */

export type OsmWayKind = 'street' | 'sidewalk' | 'footway'

export interface OsmWay {
  id: number
  kind: OsmWayKind
  name: string | null
  highway: string | null
  sidewalk: string | null
  points: Array<{ lon: number, lat: number }>
}

const SIDEWALK_HIGHWAYS = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway'])

export function classifyHighway(tags: Record<string, string | undefined>): OsmWayKind {
  const highway = tags.highway ?? ''
  if (tags.footway === 'sidewalk' || tags.footway === 'crossing') return 'sidewalk'
  if (SIDEWALK_HIGHWAYS.has(highway)) return highway === 'footway' && tags.footway === 'sidewalk' ? 'sidewalk' : 'footway'
  return 'street'
}

/** Shift a local-metre polyline left/right so sidewalks sit beside the carriageway. */
export function offsetPolyline(points: Array<[number, number]>, meters: number): Array<[number, number]> {
  if (points.length < 2) return points
  const out: Array<[number, number]> = []
  for (let i = 0; i < points.length; i++) {
    const prev = points[i === 0 ? 0 : i - 1]!
    const next = points[i === points.length - 1 ? i : i + 1]!
    const dx = next[0] - prev[0]
    const dy = next[1] - prev[1]
    const len = Math.hypot(dx, dy) || 1
    out.push([points[i]![0] + (-dy / len) * meters, points[i]![1] + (dx / len) * meters])
  }
  return out
}
