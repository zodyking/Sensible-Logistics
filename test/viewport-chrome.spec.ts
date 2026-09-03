import { describe, expect, it } from 'vitest'
import { appShellFrame, isSoftKeyboardOpen } from '../shared/utils/viewport-chrome'

describe('viewport chrome', () => {
  it('treats a large visual-viewport shrink as a soft keyboard', () => {
    expect(isSoftKeyboardOpen(800, { height: 400, offsetTop: 0 })).toBe(true)
    expect(isSoftKeyboardOpen(800, { height: 780, offsetTop: 0 })).toBe(false)
    expect(isSoftKeyboardOpen(800, { height: 720, offsetTop: 40 })).toBe(false)
    expect(isSoftKeyboardOpen(800, null)).toBe(false)
  })

  it('leaves the shell to CSS when the keyboard is closed', () => {
    expect(appShellFrame(800, { height: 780, offsetTop: 0 })).toEqual({ top: 0, height: null })
    expect(appShellFrame(800, { height: 800, offsetTop: 0 })).toEqual({ top: 0, height: null })
    expect(appShellFrame(800, null)).toEqual({ top: 0, height: null })
  })

  it('pins to the visual viewport while the keyboard is open', () => {
    expect(appShellFrame(800, { height: 420, offsetTop: 12 })).toEqual({ top: 12, height: 420 })
  })
})
