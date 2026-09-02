import { describe, expect, it } from 'vitest'
import { bboxAround, headingDelta, polygonFromBbox } from '../shared/utils/geo'
import {
  hydrateUnplaced,
  isPlacedPin,
  locationOrigin,
  mapBearingFromStreetHeading,
  nextOpenSlot,
  slotAtIndex,
  streetHeadingFromMapBearing,
} from '../shared/utils/yard-slots'

describe('map bearing ↔ street heading', () => {
  it('makes an east-west street sit horizontal at bearing 0', () => {
    expect(mapBearingFromStreetHeading(90)).toBe(0)
    expect(streetHeadingFromMapBearing(0)).toBe(90)
  })

  it('turns a north-east street so it runs left to right', () => {
    expect(mapBearingFromStreetHeading(45)).toBe(315)
    expect(headingDelta(streetHeadingFromMapBearing(315), 45)).toBeLessThan(0.01)
  })
})

describe('isPlacedPin', () => {
  it('rejects missing and 0,0 placeholders', () => {
    expect(isPlacedPin(null, null)).toBe(false)
    expect(isPlacedPin(0, 0)).toBe(false)
    expect(isPlacedPin(40.67, -73.89)).toBe(true)
  })
})

describe('locationOrigin', () => {
  it('is absent when the location has no pin and no fence', () => {
    expect(locationOrigin({ latitude: null, longitude: null })).toBeNull()
  })
})

describe('suggested yard slots', () => {
  const location = {
    latitude: 40.67,
    longitude: -73.89,
    mapHeading: 315,
    boundary: polygonFromBbox(bboxAround(40.67, -73.89, 80)),
  }
  const origin = locationOrigin(location)!

  it('lays unplaced boxes in separate slots instead of stacking them', () => {
    const items = hydrateUnplaced([
      { latitude: null, longitude: null, equipmentType: 'HC_40' as const, rotation: 0 },
      { latitude: null, longitude: null, equipmentType: 'HC_40' as const, rotation: 0 },
    ], location)

    expect(items.every(item => item.suggested)).toBe(true)
    expect(items[0]!.latitude).not.toBeNull()
    expect(items[1]!.latitude).not.toBeNull()
    expect(items[0]!.latitude).not.toBeCloseTo(items[1]!.latitude!, 6)
  })

  it('skips slots that already have a pinned box', () => {
    const first = slotAtIndex(origin, 0)
    const next = nextOpenSlot(origin, [first], 'HC_40')
    expect(next.latitude).not.toBeCloseTo(first.latitude, 6)
  })

  it('keeps already-pinned boxes in place', () => {
    const items = hydrateUnplaced([
      { latitude: 40.6701, longitude: -73.8901, equipmentType: 'HC_40' as const, rotation: 12 },
      { latitude: null, longitude: null, equipmentType: 'HC_40' as const, rotation: 0 },
    ], location)
    expect(items[0]!.suggested).toBe(false)
    expect(items[0]!.latitude).toBeCloseTo(40.6701)
    expect(items[1]!.suggested).toBe(true)
    expect(items[1]!.latitude).not.toBeNull()
  })
})
