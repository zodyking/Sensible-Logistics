/**
 * A new wizard screen starts at its title. Without this the app keeps the
 * scroll offset of the screen just left behind, so a driver who pressed a
 * button at the bottom lands mid-page on the next question.
 */
export function scrollWizardToTop() {
  if (import.meta.server) return
  requestAnimationFrame(() => {
    document.querySelector('.d-shell')?.scrollTo({ top: 0 })
    window.scrollTo({ top: 0 })
  })
}
