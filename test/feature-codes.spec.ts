import { describe, expect, it } from 'vitest'
import { FEATURE_CODES, featureIdForCode, normalizeFeatureCode, toggleFeature } from '../shared/utils/feature-codes'

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
})
