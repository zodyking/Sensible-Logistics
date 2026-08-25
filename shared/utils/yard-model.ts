import type { BoundingBox } from './geo'
import { bboxSizeMeters, projectPolyline } from './geo'
import { offsetPolyline, type OsmWay } from './osm-ways'

/**
 * Build a top-down yard schematic from a geographic bounding box and a slot
 * capacity. Local units are metres, origin at the south-west corner.
 *
 * When OSM highways are supplied, streets and sidewalks are drawn from that
 * geometry instead of a fake south-edge apron.
 */

export type YardObjectType = 'BUILDING' | 'ROAD' | 'FENCE' | 'GATE' | 'SLOT'

export interface YardObjectDraft {
  type: YardObjectType
  label: string | null
  slotCode: string | null
  x: number
  y: number
  width: number
  height: number
  kind?: 'street' | 'sidewalk' | 'footway'
  path?: Array<[number, number]>
}

export interface YardModel {
  planeWidth: number
  planeHeight: number
  objects: YardObjectDraft[]
  placedSlots: number
  streetCount: number
  sidewalkCount: number
}

function rowCode(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

function pathBounds(path: Array<[number, number]>): { x: number, y: number, width: number, height: number } {
  const xs = path.map(p => p[0])
  const ys = path.map(p => p[1])
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    x,
    y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
  }
}

function clipPath(path: Array<[number, number]>, width: number, height: number): Array<[number, number]> {
  return path.map(([x, y]) => [
    Math.max(0, Math.min(width, x)),
    Math.max(0, Math.min(height, y)),
  ])
}

function asRoad(kind: YardObjectDraft['kind'], label: string | null, path: Array<[number, number]>): YardObjectDraft {
  const bounds = pathBounds(path)
  return {
    type: 'ROAD',
    label,
    slotCode: null,
    ...bounds,
    kind,
    path,
  }
}

export function generateYardModel(box: BoundingBox, capacity: number, ways: OsmWay[] = []): YardModel {
  const size = bboxSizeMeters(box)
  const planeWidth = Math.max(36, size.width)
  const planeHeight = Math.max(28, size.height)
  const objects: YardObjectDraft[] = []

  objects.push({
    type: 'FENCE',
    label: 'Perimeter',
    slotCode: null,
    x: 0,
    y: 0,
    width: planeWidth,
    height: planeHeight,
  })

  let streetCount = 0
  let sidewalkCount = 0

  for (const way of ways) {
    const projected = clipPath(projectPolyline(box, way.points), planeWidth, planeHeight)
    if (projected.length < 2) continue

    if (way.kind === 'street') {
      objects.push(asRoad('street', way.name ?? 'Street', projected))
      streetCount++
      const sidewalkTag = (way.sidewalk ?? '').toLowerCase()
      if (sidewalkTag === 'both' || sidewalkTag === 'yes') {
        objects.push(asRoad('sidewalk', 'Sidewalk', offsetPolyline(projected, 3.2)))
        objects.push(asRoad('sidewalk', 'Sidewalk', offsetPolyline(projected, -3.2)))
        sidewalkCount += 2
      }
      else if (sidewalkTag === 'left') {
        objects.push(asRoad('sidewalk', 'Sidewalk', offsetPolyline(projected, 3.2)))
        sidewalkCount++
      }
      else if (sidewalkTag === 'right') {
        objects.push(asRoad('sidewalk', 'Sidewalk', offsetPolyline(projected, -3.2)))
        sidewalkCount++
      }
    }
    else {
      objects.push(asRoad(way.kind, way.name ?? (way.kind === 'sidewalk' ? 'Sidewalk' : 'Walkway'), projected))
      if (way.kind === 'sidewalk') sidewalkCount++
    }
  }

  const hasMappedStreet = streetCount > 0
  const apron = hasMappedStreet ? 0 : Math.min(8, planeHeight * 0.14)

  if (!hasMappedStreet) {
    objects.push({
      type: 'ROAD',
      label: 'Street frontage',
      slotCode: null,
      x: 0,
      y: 0,
      width: planeWidth,
      height: apron,
      kind: 'street',
    })
  }

  const gateW = Math.min(14, Math.max(8, planeWidth * 0.18))
  objects.push({
    type: 'GATE',
    label: 'Gate',
    slotCode: null,
    x: (planeWidth - gateW) / 2,
    y: 0,
    width: gateW,
    height: Math.max(3.5, Math.max(apron, 4) * 0.55),
  })

  const officeW = Math.min(16, Math.max(10, planeWidth * 0.18))
  const officeH = Math.min(12, Math.max(8, planeHeight * 0.16))
  objects.push({
    type: 'BUILDING',
    label: 'Office',
    slotCode: null,
    x: planeWidth - officeW - 3,
    y: apron + 2,
    width: officeW,
    height: officeH,
  })

  const wanted = Math.max(0, Math.floor(capacity))
  const slotW = 2.6
  const slotL = 6.2
  const gap = 1.1
  const aisle = 4.2
  const startX = 4
  const startY = apron + 3
  const maxX = planeWidth - officeW - 6
  const maxY = planeHeight - 3

  let placed = 0
  let row = 0
  while (placed < wanted && row < 80) {
    const y = startY + row * (slotL + (row % 2 === 1 ? aisle : gap))
    if (y + slotL > maxY) break
    let col = 0
    while (placed < wanted) {
      const x = startX + col * (slotW + gap)
      if (x + slotW > maxX) break
      const code = `${rowCode(row)}${String(col + 1).padStart(2, '0')}`
      objects.push({
        type: 'SLOT',
        label: code,
        slotCode: code,
        x,
        y,
        width: slotW,
        height: slotL,
      })
      placed++
      col++
    }
    if (col === 0) break
    row++
  }

  return { planeWidth, planeHeight, objects, placedSlots: placed, streetCount, sidewalkCount }
}
