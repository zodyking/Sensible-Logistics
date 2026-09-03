/**
 * Decide when the visual viewport is the soft keyboard rather than Safari
 * chrome. URL-bar show/hide is a small, gradual change; a keyboard covers a
 * large slice of the layout viewport.
 */
export const KEYBOARD_MIN_PX = 160
export const KEYBOARD_HEIGHT_RATIO = 0.28

export interface VisualViewportBox {
  height: number
  offsetTop: number
}

export function isSoftKeyboardOpen(
  layoutHeight: number,
  visual: VisualViewportBox | null | undefined,
): boolean {
  if (!visual || !Number.isFinite(layoutHeight) || layoutHeight <= 0) return false
  if (!Number.isFinite(visual.height) || visual.height <= 0) return false
  const covered = layoutHeight - visual.height
  return covered >= KEYBOARD_MIN_PX && covered / layoutHeight >= KEYBOARD_HEIGHT_RATIO
}

/**
 * Frame for the app shell.
 *
 * Resting state returns `null` height so CSS `inset: 0` fills the layout
 * viewport — no pixel height that can race iOS Safari and leave a gap under
 * the tab bar. When the keyboard is open, pin to the visual viewport.
 */
export function appShellFrame(
  layoutHeight: number,
  visual: VisualViewportBox | null | undefined,
): { top: number, height: number | null } {
  if (!isSoftKeyboardOpen(layoutHeight, visual) || !visual) {
    return { top: 0, height: null }
  }
  return {
    top: Math.max(0, visual.offsetTop),
    height: visual.height,
  }
}
