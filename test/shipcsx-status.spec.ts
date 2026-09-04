import { describe, expect, it } from 'vitest'
import { shipcsxMetaLine, shipcsxPublicError, shipcsxStatusLabel } from '../shared/utils/shipcsx-status'

describe('shipcsxStatusLabel', () => {
  it('uses a calm empty state before the first check', () => {
    expect(shipcsxStatusLabel(null)).toBe('Not checked')
  })

  it('prefers in-gate copy and never shows raw underscores', () => {
    expect(shipcsxStatusLabel({ inGateReadiness: 'Ready to in-gate', resultTab: 'IN_GATE' }))
      .toBe('Ready to in-gate')
    expect(shipcsxStatusLabel({ resultTab: 'NOT_FOUND' })).toBe('Not on CSX')
    expect(shipcsxStatusLabel({ resultTab: 'ENROUTE' })).toBe('En route')
  })

  it('marks a failed lookup without using Server Error', () => {
    expect(shipcsxStatusLabel({ error: 'Playwright is not installed.', resultTab: 'NOT_FOUND' }))
      .toBe('Couldn\'t check')
  })
})

describe('shipcsxPublicError', () => {
  it('hides install and login internals', () => {
    expect(shipcsxPublicError('Playwright is not installed. Run npx playwright install chromium.'))
      .toBe('ShipCSX lookup is not set up on this server yet.')
    expect(shipcsxPublicError('ShipCSX needs a signed-in profile. Set NUXT_SHIPCSX_EMAIL'))
      .toBe('ShipCSX is not signed in on this server.')
    expect(shipcsxPublicError('Set a ShipCSX terminal name on the rail location or NUXT_SHIPCSX_DEFAULT_TERMINAL.'))
      .toBe('Set a ShipCSX terminal name on the rail location.')
  })
})

describe('shipcsxMetaLine', () => {
  it('joins the compact facts', () => {
    expect(shipcsxMetaLine({
      loadEmpty: 'Empty',
      waybillDate: '09/01/26',
      gateWindow: '05:00–21:00',
    })).toBe('Empty · Waybill 09/01/26 · 05:00–21:00')
  })
})
