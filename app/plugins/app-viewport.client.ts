import { appShellFrame } from '#shared/utils/viewport-chrome'

/**
 * Size the app shell to the layout viewport by default (CSS `inset: 0`).
 *
 * iOS Safari’s visualViewport.height is often a few dozen pixels short on
 * the first paint and during URL-bar animation. Writing that value into
 * `--app-height` leaves a white gap under the tab bar until a later resize
 * “corrects” it. Only override the CSS frame when the soft keyboard is open.
 */
export default defineNuxtPlugin(() => {
  const root = document.documentElement

  const sync = () => {
    const visual = window.visualViewport
    const frame = appShellFrame(
      window.innerHeight,
      visual ? { height: visual.height, offsetTop: visual.offsetTop } : null,
    )
    if (frame.height == null) {
      root.classList.remove('keyboard-open')
      root.style.removeProperty('--app-height')
      root.style.removeProperty('--app-top')
      return
    }
    root.classList.add('keyboard-open')
    root.style.setProperty('--app-height', `${frame.height}px`)
    root.style.setProperty('--app-top', `${frame.top}px`)
  }

  const syncSoon = () => {
    requestAnimationFrame(() => {
      sync()
      requestAnimationFrame(sync)
    })
  }

  sync()
  window.visualViewport?.addEventListener('resize', syncSoon)
  window.visualViewport?.addEventListener('scroll', syncSoon)
  window.addEventListener('resize', syncSoon)
  window.addEventListener('orientationchange', syncSoon)
  window.addEventListener('pageshow', syncSoon)
  window.addEventListener('focusin', syncSoon)
  window.addEventListener('focusout', syncSoon)
})
