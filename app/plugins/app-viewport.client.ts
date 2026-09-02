/**
 * Bind the app shell to the visual viewport.
 *
 * iOS Safari’s layout viewport is taller than the area the driver actually
 * sees. A `position: fixed; bottom: 0` tab bar then sits on that short box
 * and leaves a scrollable gap under it. `--app-height` / `--app-top` size
 * the shell to what is on screen, including URL-bar show/hide.
 */
export default defineNuxtPlugin(() => {
  const root = document.documentElement

  const sync = () => {
    const viewport = window.visualViewport
    root.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`)
    root.style.setProperty('--app-top', `${viewport?.offsetTop ?? 0}px`)
  }

  sync()
  window.visualViewport?.addEventListener('resize', sync)
  window.visualViewport?.addEventListener('scroll', sync)
  window.addEventListener('orientationchange', sync)
})
