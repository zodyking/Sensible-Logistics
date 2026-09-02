/**
 * A new wizard screen starts at its title. Without this the app keeps the
 * scroll offset of the screen just left behind, so a driver who pressed a
 * button at the bottom lands mid-page on the next question.
 *
 * The page itself does not scroll — the layout content pane does.
 */
export function scrollWizardToTop() {
  if (import.meta.server) return
  requestAnimationFrame(() => {
    const scroller = document.querySelector<HTMLElement>('.d-shell, .auth-main, .a-body')
    if (scroller) scroller.scrollTo({ top: 0 })
    else window.scrollTo({ top: 0 })
  })
}
