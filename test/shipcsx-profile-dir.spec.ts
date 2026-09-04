import { describe, expect, it } from 'vitest'
import {
  SHIPCSX_TMP_PROFILE_DIR,
  resolveShipcsxProfileDir,
  shipcsxProfileDirFallbacks,
} from '../shared/utils/shipcsx-profile-dir'

describe('resolveShipcsxProfileDir', () => {
  it('uses an absolute configured path as-is', () => {
    expect(resolveShipcsxProfileDir({
      configured: '/tmp/shipcsx-profile',
      home: '/home/nuxt',
      cwd: '/app',
    })).toBe('/tmp/shipcsx-profile')
  })

  it('resolves a relative configured path against cwd', () => {
    expect(resolveShipcsxProfileDir({
      configured: '.data/shipcsx-profile',
      home: '/tmp',
      cwd: '/app',
    })).toBe('/app/.data/shipcsx-profile')
  })

  it('uses HOME/shipcsx-profile when nothing is configured', () => {
    expect(resolveShipcsxProfileDir({
      configured: '',
      home: '/tmp',
      cwd: '/app',
    })).toBe('/tmp/shipcsx-profile')
  })

  it('does not default to an unwritable /app/.data directory', () => {
    expect(resolveShipcsxProfileDir({
      configured: '  ',
      home: '',
      cwd: '/app',
    })).toBe(SHIPCSX_TMP_PROFILE_DIR)
    expect(resolveShipcsxProfileDir({
      configured: '',
      home: '/',
      cwd: '/app',
    })).not.toContain('/app/.data')
  })
})

describe('shipcsxProfileDirFallbacks', () => {
  it('falls back to /tmp when the configured path is under /app', () => {
    expect(shipcsxProfileDirFallbacks('/app/.data/shipcsx-profile', '/tmp')).toEqual([
      '/app/.data/shipcsx-profile',
      '/tmp/shipcsx-profile',
    ])
  })
})
