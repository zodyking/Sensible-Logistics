import { describe, expect, it } from 'vitest'
import { bboxAround, bboxFromExtent, bboxFromPolygon, isValidBbox, polygonFromBbox } from '../shared/utils/geo'
import { generateYardModel } from '../shared/utils/yard-model'

describe('bboxFromExtent', () => {
  it('normalises Photon corner order', () => {
    const box = bboxFromExtent([-80.13, 26.08, -80.11, 26.06])
    expect(box).toEqual({ west: -80.13, east: -80.11, south: 26.06, north: 26.08 })
  })
})

describe('polygonFromBbox', () => {
  it('closes the ring and round-trips', () => {
    const box = { west: -80.2, south: 26.0, east: -80.1, north: 26.1 }
    const polygon = polygonFromBbox(box)
    expect(polygon.coordinates[0]?.[0]).toEqual(polygon.coordinates[0]?.at(-1))
    expect(bboxFromPolygon(polygon)).toEqual(box)
  })
})

describe('bboxAround', () => {
  it('produces a valid box around a point', () => {
    const box = bboxAround(26.09, -80.12, 150)
    expect(isValidBbox(box)).toBe(true)
    expect(box.west).toBeLessThan(-80.12)
    expect(box.east).toBeGreaterThan(-80.12)
  })
})

describe('generateYardModel', () => {
  it('places the requested number of slots when the box is large enough', () => {
    const box = bboxAround(26.09, -80.12, 400)
    const model = generateYardModel(box, 24)
    expect(model.objects.some(o => o.type === 'GATE')).toBe(true)
    expect(model.objects.some(o => o.type === 'BUILDING')).toBe(true)
    expect(model.placedSlots).toBe(24)
    expect(model.objects.filter(o => o.type === 'SLOT')).toHaveLength(24)
  })

  it('still draws a perimeter when capacity is zero', () => {
    const box = bboxAround(26.09, -80.12, 80)
    const model = generateYardModel(box, 0)
    expect(model.placedSlots).toBe(0)
    expect(model.objects.some(o => o.type === 'FENCE')).toBe(true)
  })

  it('draws OSM streets and sidewalks as polylines when they are mapped', () => {
    const box = bboxAround(26.09, -80.12, 200)
    const model = generateYardModel(box, 4, [
      {
        id: 1,
        kind: 'street',
        name: 'Eller Drive',
        highway: 'unclassified',
        sidewalk: 'both',
        points: [
          { lon: box.west + 0.0002, lat: box.south + 0.0002 },
          { lon: box.east - 0.0002, lat: box.south + 0.0004 },
        ],
      },
      {
        id: 2,
        kind: 'sidewalk',
        name: null,
        highway: 'footway',
        sidewalk: 'sidewalk',
        points: [
          { lon: box.west + 0.0003, lat: box.south + 0.0006 },
          { lon: box.east - 0.0003, lat: box.south + 0.0007 },
        ],
      },
    ])
    expect(model.streetCount).toBe(1)
    expect(model.sidewalkCount).toBeGreaterThan(0)
    expect(model.objects.some(o => o.kind === 'street' && o.path && o.path.length >= 2)).toBe(true)
    expect(model.objects.some(o => o.kind === 'sidewalk' && o.path && o.path.length >= 2)).toBe(true)
  })
})
