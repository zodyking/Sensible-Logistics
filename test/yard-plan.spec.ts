import { describe, expect, it } from 'vitest'
import { bboxFromPolygon, polygonFromBbox } from '../shared/utils/geo'
import {
  bufferBbox,
  chassisFootprintMeters,
  fenceToPavement,
  geometryToGeo,
  geometryToLocal,
  keepManualFeatures,
  layoutFromBoundary,
  layoutOriginFromBox,
  lngLatToLocal,
  localToLngLat,
  nearestSlot,
  simplifyLine,
  squareNearlyRectangularPolygon,
  suggestSlots,
  YARD_BUFFER_METERS,
} from '../shared/utils/yard-plan'

const fence = polygonFromBbox({ west: -74.01, south: 40.70, east: -73.99, north: 40.71 })

describe('yard layout origin', () => {
  it('buffers the fence and round-trips lat/lng through local metres', () => {
    const box = bboxFromPolygon(fence)!
    const buffered = bufferBbox(box, YARD_BUFFER_METERS)
    expect(buffered.west).toBeLessThan(box.west)
    expect(buffered.north).toBeGreaterThan(box.north)

    const origin = layoutOriginFromBox(buffered, 12)
    const local = lngLatToLocal(origin, 40.705, -74.0)
    const back = localToLngLat(origin, local.x, local.y)
    expect(back.latitude).toBeCloseTo(40.705, 5)
    expect(back.longitude).toBeCloseTo(-74.0, 5)
  })

  it('converts a geo polygon into local metres and back', () => {
    const planned = layoutFromBoundary(fence, 0, 50)
    expect(planned).not.toBeNull()
    const local = geometryToLocal(fence, planned!.origin)
    const geo = geometryToGeo(local, planned!.origin)
    expect(geo.type).toBe('Polygon')
    if (geo.type === 'Polygon') {
      expect(geo.coordinates[0]![0]![0]).toBeCloseTo(fence.coordinates[0]![0]![0]!, 4)
    }
  })
})

describe('simplify and square', () => {
  it('drops colinear vertices', () => {
    const line: [number, number][] = [[0, 0], [1, 0], [2, 0], [3, 0]]
    expect(simplifyLine(line, 0.2)).toEqual([[0, 0], [3, 0]])
  })

  it('squares a nearly rectangular building', () => {
    const jagged: [number, number][] = [
      [0, 0], [10, 0.2], [10.1, 8], [0.1, 8], [0, 0],
    ]
    const squared = squareNearlyRectangularPolygon({ type: 'Polygon', coordinates: [jagged] })
    expect(squared.type).toBe('Polygon')
    if (squared.type === 'Polygon') {
      expect(squared.coordinates[0]).toHaveLength(5)
    }
  })
})

describe('manual corrections survive regeneration', () => {
  it('keeps only features the driver edited', () => {
    const kept = keepManualFeatures([
      { id: 'a', manuallyModified: true },
      { id: 'b', manuallyModified: false },
    ])
    expect(kept.map(item => item.id)).toEqual(['a'])
  })
})

describe('suggested slots', () => {
  it('places stalls on a pavement rectangle and skips a building', () => {
    const origin = layoutFromBoundary(fence)!.origin
    const pavement = fenceToPavement(fence, origin)
    const building = {
      ...pavement,
      type: 'BUILDING' as const,
      localGeometry: {
        type: 'Polygon' as const,
        coordinates: [[[20, 20], [40, 20], [40, 40], [20, 40], [20, 20]]] as [number, number][][],
      },
    }
    const slots = suggestSlots({
      pavement: [pavement],
      buildings: [building],
      roads: [],
      rotationDeg: 0,
      planeWidth: origin.planeWidth,
      planeHeight: origin.planeHeight,
    })
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.some(slot => slot.x > 20 && slot.x < 40 && slot.y > 20 && slot.y < 40)).toBe(false)
  })

  it('snaps a free drop to the nearest stall inside 2.4 m', () => {
    const hit = nearestSlot(10.5, 10.2, [{ x: 10, y: 10, rotation: 90, id: 'A01' }])
    expect(hit?.id).toBe('A01')
    expect(nearestSlot(40, 40, [{ x: 10, y: 10, rotation: 0 }])).toBeNull()
  })
})

describe('chassis footprint', () => {
  it('is longer than a 20ft box and narrower than a container is tall in plan', () => {
    const size = chassisFootprintMeters()
    expect(size.length).toBeGreaterThan(10)
    expect(size.width).toBeLessThan(3)
  })
})
