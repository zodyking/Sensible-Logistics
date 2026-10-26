import { describe, expect, it } from 'vitest'
import { canEditTripSeal, isSealDoubleTap, SEAL_DOUBLE_TAP_MS } from '../shared/utils/trip-seal'

describe('canEditTripSeal', () => {
  it('allows a loaded box on a live pickup or drop-off', () => {
    expect(canEditTripSeal({ kind: 'CONTAINER', status: 'IN_TRANSIT', isLoaded: true })).toBe(true)
    expect(canEditTripSeal({ kind: 'CONTAINER', status: 'PICKUP_IN_PROGRESS', isLoaded: true })).toBe(true)
    expect(canEditTripSeal({ kind: 'CONTAINER', status: 'DROPOFF_IN_PROGRESS', isLoaded: true })).toBe(true)
  })

  it('blocks empty, finished, and bare chassis trips', () => {
    expect(canEditTripSeal({ kind: 'CONTAINER', status: 'IN_TRANSIT', isLoaded: false })).toBe(false)
    expect(canEditTripSeal({ kind: 'CONTAINER', status: 'COMPLETED', isLoaded: true })).toBe(false)
    expect(canEditTripSeal({ kind: 'BARE_CHASSIS', status: 'IN_TRANSIT', isLoaded: true })).toBe(false)
  })
})

describe('isSealDoubleTap', () => {
  it('treats a second tap inside the window as a double tap', () => {
    expect(isSealDoubleTap(1000, 1000 + SEAL_DOUBLE_TAP_MS)).toBe(true)
    expect(isSealDoubleTap(1000, 1000 + SEAL_DOUBLE_TAP_MS + 1)).toBe(false)
    expect(isSealDoubleTap(null, 1000)).toBe(false)
  })
})
