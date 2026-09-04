import { describe, expect, it } from 'vitest'
import {
  chunkShipcsxEquipment,
  isShipcsxPollWindow,
  matchLookupCard,
  parseShipcsxLookupText,
} from '../shared/utils/csx-lookup'

const RESULTS = `
Shipment Lookup Results
As of 17:03 on 09/03/26
NOTIFIED (0) ENROUTE (0) IN-GATE (1) OTHERS (0)
KOSU 495338
Load / Empty: Load
Waybill Date: 09/03/26
In-Gate Readiness: Ready to In-Gate
Gate Window: Expires at 09/03 23:59
`

describe('ShipCSX lookup parse', () => {
  it('reads the in-gate card from results text', () => {
    const parsed = parseShipcsxLookupText(RESULTS)
    expect(parsed.tabCounts.IN_GATE).toBe(1)
    const card = matchLookupCard(parsed.cards, 'KOSU495338')
    expect(card?.resultTab).toBe('IN_GATE')
    expect(card?.loadEmpty).toBe('Load')
    expect(card?.waybillDate).toBe('09/03/26')
    expect(card?.inGateReadiness).toBe('Ready to In-Gate')
    expect(card?.gateWindow).toContain('09/03 23:59')
  })

  it('ignores reservation success copy', () => {
    const parsed = parseShipcsxLookupText('Reservation Successful\nReservation ID: NBDLNQ\nSubmit')
    expect(parsed.cards).toEqual([])
  })

  it('batches equipment three at a time', () => {
    expect(chunkShipcsxEquipment(['a', 'b', 'c', 'd']).map(batch => batch.length)).toEqual([3, 1])
  })
})

describe('ShipCSX poll window', () => {
  it('is open at 5am and 9pm Eastern', () => {
    expect(isShipcsxPollWindow(new Date('2026-01-15T10:00:00.000Z'))).toBe(true)
    expect(isShipcsxPollWindow(new Date('2026-07-15T09:00:00.000Z'))).toBe(true)
  })

  it('is closed at 4am and 10pm Eastern', () => {
    expect(isShipcsxPollWindow(new Date('2026-01-15T09:00:00.000Z'))).toBe(false)
    expect(isShipcsxPollWindow(new Date('2026-01-16T03:00:00.000Z'))).toBe(false)
  })
})
