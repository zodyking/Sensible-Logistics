/** Keep a UI state on screen at least `minMs` after `startedAt`. */
export function waitAtLeast(startedAt: number, minMs: number) {
  const remaining = minMs - (Date.now() - startedAt)
  if (remaining <= 0) return Promise.resolve()
  return new Promise<void>(resolve => setTimeout(resolve, remaining))
}
