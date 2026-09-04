import { describe, expect, it } from 'vitest'
import {
  chunkShipcsxEquipment,
  isShipcsxPollWindow,
  matchLookupCard,
  matchShipcsxTerminalOption,
  parseShipcsxLookupText,
  shipcsxEquipmentParts,
  shipcsxPageLooksHardBlocked,
  shipcsxPageLooksLikeChallenge,
  shipcsxPageLooksLikeLogin,
  cleanShipcsxTerminalNames,
  pickShipcsxTerminal,
  resolveShipcsxTerminalName,
  SHIPCSX_TERMINALS,
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

describe('ShipCSX equipment parts', () => {
  it('splits ISO numbers into the 4-letter initial and 6-digit serial', () => {
    expect(shipcsxEquipmentParts('KOSU496803-5')).toEqual({ initial: 'KOSU', number: '496803' })
    expect(shipcsxEquipmentParts('KOSU4968035')).toEqual({ initial: 'KOSU', number: '496803' })
    expect(shipcsxEquipmentParts('kosu 496803')).toEqual({ initial: 'KOSU', number: '496803' })
    expect(shipcsxEquipmentParts('ABC')).toBeNull()
  })
})

describe('ShipCSX terminal names', () => {
  it('lists the five CSX facilities we check', () => {
    expect([...SHIPCSX_TERMINALS]).toEqual([
      'North Bergen',
      'Little Ferry',
      'South Kearny',
      'Elizabeth',
      'Newark',
    ])
  })

  it('drops placeholders and sorts unique labels', () => {
    expect(cleanShipcsxTerminalNames([
      'Select Terminal',
      ' North Bergen ',
      'Fairburn',
      'North Bergen',
      'OK',
    ])).toEqual(['Fairburn', 'North Bergen'])
  })

  it('matches a stored rail name onto the fixed facility list', () => {
    expect(matchShipcsxTerminalOption([...SHIPCSX_TERMINALS], 'south kearny, nj')).toBe('South Kearny')
    expect(matchShipcsxTerminalOption([...SHIPCSX_TERMINALS], 'Fairburn')).toBeNull()
  })

  it('defaults a missing rail location to North Bergen', () => {
    expect(pickShipcsxTerminal(null)).toBe('North Bergen')
    expect(pickShipcsxTerminal('NJ Yard')).toBe('North Bergen')
    expect(pickShipcsxTerminal('Little Ferry')).toBe('Little Ferry')
    expect(resolveShipcsxTerminalName({ destName: 'NJ Yard', destType: 'COMPANY_YARD' }))
      .toBe('North Bergen')
    expect(resolveShipcsxTerminalName({
      destType: 'RAIL_TERMINAL',
      destName: 'South Kearny',
    })).toBe('South Kearny')
  })
})
describe('ShipCSX terminal option match', () => {
  const options = ['Select Terminal', 'North Bergen', 'Fairburn', 'Northwest Ohio']

  it('matches the stored rail name to a dropdown label', () => {
    expect(matchShipcsxTerminalOption(options, 'North Bergen')).toBe('North Bergen')
    expect(matchShipcsxTerminalOption(options, 'north bergen, nj')).toBe('North Bergen')
    expect(matchShipcsxTerminalOption(options, 'Missing Yard')).toBeNull()
  })
})

describe('ShipCSX page sniffers', () => {
  it('detects a hard Cloudflare block without treating the lookup form as blocked', () => {
    expect(shipcsxPageLooksHardBlocked('Sorry, you have been blocked')).toBe(true)
    expect(shipcsxPageLooksHardBlocked('Select Terminal\nEquipment Initial')).toBe(false)
    expect(shipcsxPageLooksLikeChallenge('Just a moment...')).toBe(true)
    expect(shipcsxPageLooksLikeLogin('Sign in\nPassword', 'https://next.shipcsx.com/#/login')).toBe(true)
    expect(shipcsxPageLooksLikeLogin('Equipment Lookup', 'https://next.shipcsx.com/#/shipment/lookup')).toBe(false)
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
