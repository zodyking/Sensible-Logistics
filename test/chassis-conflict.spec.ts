import { describe, expect, it } from 'vitest'
import { chassisInUsePrompt, chassisNeedsRelease } from '../shared/utils/chassis-conflict'

describe('chassisNeedsRelease', () => {
  it('is false when the chassis is free', () => {
    expect(chassisNeedsRelease(null)).toBe(false)
    expect(chassisNeedsRelease(undefined, 'box-1')).toBe(false)
  })

  it('is false when the chassis is already on this container', () => {
    expect(chassisNeedsRelease('box-1', 'box-1')).toBe(false)
  })

  it('is true when the chassis is on a different container', () => {
    expect(chassisNeedsRelease('box-1')).toBe(true)
    expect(chassisNeedsRelease('box-1', 'box-2')).toBe(true)
    expect(chassisNeedsRelease('box-1', null)).toBe(true)
  })
})

describe('chassisInUsePrompt', () => {
  it('names the attached container', () => {
    expect(chassisInUsePrompt('MSCU1234560')).toBe(
      'This chassis is attached to container number MSCU123456-0 already. Would you like to release it?',
    )
  })

  it('falls back when the number is missing', () => {
    expect(chassisInUsePrompt(null)).toBe(
      'This chassis is attached to container number another container already. Would you like to release it?',
    )
  })
})
