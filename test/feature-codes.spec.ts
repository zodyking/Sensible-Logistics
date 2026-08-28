import { describe, expect, it } from 'vitest'
import { FEATURE_CODES, featureIdForCode, normalizeFeatureCode, parseUnlockedFeatures, toggleFeature } from '../shared/utils/feature-codes'

describe('normalizeFeatureCode', () => {
  it('trims, uppercases, and strips spaces while keeping hyphens', () => {
    expect(normalizeFeatureCode(' sl-api ')).toBe('SL-API')
    expect(normalizeFeatureCode('SL API')).toBe('SLAPI')
    expect(normalizeFeatureCode('sl-api')).toBe('SL-API')
  })
})

describe('featureIdForCode', () => {
  it('maps the connections cheat code', () => {
    expect(featureIdForCode(FEATURE_CODES.CONNECTIONS)).toBe('CONNECTIONS')
    expect(featureIdForCode('sl-api')).toBe('CONNECTIONS')
    expect(featureIdForCode('nope')).toBeNull()
  })

  it('maps the clear-records cheat code', () => {
    expect(featureIdForCode(FEATURE_CODES.RESET)).toBe('RESET')
    expect(featureIdForCode('sl-clr')).toBe('RESET')
  })
})

describe('parseUnlockedFeatures', () => {
  it('keeps known feature ids and drops everything else', () => {
    expect(parseUnlockedFeatures(['CONNECTIONS', 'RESET', 'NOPE', 1])).toEqual(['CONNECTIONS', 'RESET'])
    expect(parseUnlockedFeatures(null)).toEqual([])
  })
})

describe('toggleFeature', () => {
  it('enables then disables the same code', () => {
    const on = toggleFeature([], 'CONNECTIONS')
    expect(on.enabled).toBe(true)
    expect(on.unlocked).toEqual(['CONNECTIONS'])
    const off = toggleFeature(on.unlocked, 'CONNECTIONS')
    expect(off.enabled).toBe(false)
    expect(off.unlocked).toEqual([])
  })

  it('toggles clear-records independently of connections', () => {
    const on = toggleFeature(['CONNECTIONS'], 'RESET')
    expect(on.enabled).toBe(true)
    expect(on.unlocked).toEqual(['CONNECTIONS', 'RESET'])
    const off = toggleFeature(on.unlocked, 'RESET')
    expect(off.enabled).toBe(false)
    expect(off.unlocked).toEqual(['CONNECTIONS'])
  })
})
