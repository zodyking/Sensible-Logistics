/** Product name shown in the brand bar, titles, PWA, and mail. */
export const PRODUCT_NAME = 'Yard Manager'

function foldProductName(value: string) {
  return value
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+llc$/, '')
    .trim()
}

const STALE_PRODUCT_NAMES = new Set([
  'gantry',
  'sensible logistics',
  'sensible logistics solutions',
  'container tracker',
])

/**
 * Ignore leftover deploy env (`NUXT_PUBLIC_APP_NAME`) that still has the old
 * LLC name or Gantry, so the header cannot keep showing a retired title.
 */
export function resolveProductName(raw: unknown): string {
  if (typeof raw !== 'string') return PRODUCT_NAME
  const value = raw.trim()
  if (!value) return PRODUCT_NAME
  const folded = foldProductName(value)
  if (STALE_PRODUCT_NAMES.has(folded) || folded.startsWith('sensible logistics')) {
    return PRODUCT_NAME
  }
  return value
}
