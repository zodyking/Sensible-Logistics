import { describe, expect, it } from 'vitest'
import {
  findTripGaps,
  gapKey,
  normalizePlace,
  resolutionMap,
  samePlace,
  weaveGapsIntoTrips,
} from '../shared/utils/trip-gaps'

const morning = {
  id: 'a',
  createdAt: '2026-09-03T08:00:00.000Z',
  pickedUpAt: '2026-09-03T08:00:00.000Z',
  originLocationId: 'port',
  destinationLocationId: 'yard',
  originName: 'Port',
  destinationName: 'Yard',
}

const midday = {
  id: 'b',
  createdAt: '2026-09-03T12:00:00.000Z',
  pickedUpAt: '2026-09-03T12:00:00.000Z',
  originLocationId: 'yard',
  destinationLocationId: 'customer',
  originName: 'Yard',
  destinationName: 'Customer',
}

const later = {
  id: 'c',
  createdAt: '2026-09-03T16:00:00.000Z',
  pickedUpAt: '2026-09-03T16:00:00.000Z',
  originLocationId: 'port',
  destinationLocationId: 'rail',
  originName: 'Port',
  destinationName: 'Rail',
}

describe('samePlace', () => {
  it('prefers location ids when both sides have them', () => {
    expect(samePlace({ id: '1', name: 'Yard' }, { id: '1', name: 'Other' })).toBe(true)
    expect(samePlace({ id: '1', name: 'Yard' }, { id: '2', name: 'Yard' })).toBe(false)
  })

  it('falls back to a normalised name', () => {
    expect(samePlace({ name: 'APM Terminal' }, { name: 'apm  terminal' })).toBe(true)
    expect(samePlace({ name: 'Yard' }, { name: 'Port' })).toBe(false)
    expect(samePlace({ name: '' }, { name: 'Port' })).toBe(false)
  })
})

describe('normalizePlace', () => {
  it('strips punctuation and extra space', () => {
    expect(normalizePlace('  APM-Terminal, LLC  ')).toBe('apm terminal llc')
  })
})

describe('findTripGaps', () => {
  it('finds no gap when the next origin is the prior destination', () => {
    expect(findTripGaps([midday, morning])).toEqual([])
  })

  it('detects a break and names the hop from prior dest to next origin', () => {
    const gaps = findTripGaps([later, midday, morning])
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({
      key: gapKey('b', 'c'),
      priorTripId: 'b',
      nextTripId: 'c',
      fromName: 'Customer',
      toName: 'Port',
    })
  })

  it('skips a hop when either place is unknown', () => {
    expect(findTripGaps([
      { ...morning, destinationLocationId: null, destinationName: null },
      midday,
    ])).toEqual([])
  })
})

describe('weaveGapsIntoTrips', () => {
  it('places the gap card immediately before the later trip', () => {
    const gaps = findTripGaps([morning, midday, later])
    const rows = weaveGapsIntoTrips([morning, midday, later], gaps)
    expect(rows.map(row => row.kind === 'trip' ? row.trip.id : `gap:${row.gap.fromName}`))
      .toEqual(['a', 'b', 'gap:Customer', 'c'])
  })
})

describe('resolutionMap', () => {
  it('keys confirmations by the trip pair', () => {
    const map = resolutionMap([
      { priorTripId: 'b', nextTripId: 'c', resolution: 'BOBTAIL' },
    ])
    expect(map.get(gapKey('b', 'c'))).toBe('BOBTAIL')
  })
})
