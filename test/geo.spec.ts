import { describe, expect, it } from 'vitest'
import { countContainersByType } from '../shared/utils/domain'
import {
  bboxAround,
  bearingDeg,
  containerCorners,
  haversineMeters,
  longestEdgeBearing,
  normalizeHeading,
  pointInPolygon,
  polygonFromBbox,
  snapHeadingToStreet,
} from '../shared/utils/geo'

describe('containerCorners', () => {
  it('places the long axis north when heading is 0', () => {
    const corners = containerCorners(26.1, -80.2, 12, 2.4, 0)
    const lats = corners.map(c => c[0])
    const lngs = corners.map(c => c[1])
    expect(Math.max(...lats) - Math.min(...lats)).toBeGreaterThan(Math.max(...lngs) - Math.min(...lngs))
  })

  it('rotates the long axis east when heading is 90', () => {
    const corners = containerCorners(26.1, -80.2, 12, 2.4, 90)
    const lats = corners.map(c => c[0])
    const lngs = corners.map(c => c[1])
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeGreaterThan(Math.max(...lats) - Math.min(...lats))
  })
})

describe('pointInPolygon', () => {
  it('accepts a point inside a bbox ring and rejects one outside', () => {
    const polygon = polygonFromBbox(bboxAround(26.1, -80.2, 80))
    expect(pointInPolygon(26.1, -80.2, polygon)).toBe(true)
    expect(pointInPolygon(26.2, -80.2, polygon)).toBe(false)
  })
})

describe('snapHeadingToStreet', () => {
  it('keeps the closer of the street heading and its reverse', () => {
    expect(snapHeadingToStreet(10, 0)).toBe(0)
    expect(snapHeadingToStreet(170, 0)).toBe(180)
  })
})

describe('longestEdgeBearing', () => {
  it('returns the east-west edge of a wide rectangle', () => {
    const polygon = polygonFromBbox({ west: -80.21, south: 26.10, east: -80.19, north: 26.101 })
    const heading = longestEdgeBearing(polygon)
    expect(heading).not.toBeNull()
    const aligned = Math.min(headingDelta(heading!, 90), headingDelta(heading!, 270))
    expect(aligned).toBeLessThan(1)
  })
})

describe('haversineMeters / bearingDeg', () => {
  it('measures a short north-south segment', () => {
    const metres = haversineMeters(26.10, -80.20, 26.101, -80.20)
    expect(metres).toBeGreaterThan(100)
    expect(metres).toBeLessThan(120)
    expect(normalizeHeading(bearingDeg(26.10, -80.20, 26.101, -80.20))).toBeCloseTo(0, 0)
  })
})

describe('countContainersByType', () => {
  it('counts every brand including zeros', () => {
    const counts = countContainersByType([
      { containerType: 'KING_OCEAN' },
      { containerType: 'KING_OCEAN' },
      { containerType: 'CMA' },
    ])
    expect(counts).toEqual({ KING_OCEAN: 2, TROPICAL: 0, CMA: 1, ZIM: 0 })
  })
})

function headingDelta(a: number, b: number) {
  const delta = Math.abs(normalizeHeading(a) - normalizeHeading(b))
  return Math.min(delta, 360 - delta)
}
