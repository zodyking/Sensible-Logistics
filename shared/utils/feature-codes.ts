/**
 * Operator cheat codes. The More page never explains these — entering a code
 * toggles the matching hidden feature for that user until they enter it again.
 */
export const FEATURE_IDS = ['CONNECTIONS', 'RESET'] as const
export type FeatureId = (typeof FEATURE_IDS)[number]

export const FEATURE_CODES: Record<FeatureId, string> = {
  CONNECTIONS: 'SL-API',
  RESET: 'SL-CLR',
}

export function normalizeFeatureCode(value: string | null | undefined): string {
  return String(value ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

export function featureIdForCode(raw: string): FeatureId | null {
  const submitted = normalizeFeatureCode(raw)
  if (!submitted) return null
  for (const id of FEATURE_IDS) {
    if (normalizeFeatureCode(FEATURE_CODES[id]) === submitted) return id
  }
  return null
}

export function parseUnlockedFeatures(raw: unknown): FeatureId[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is FeatureId => typeof item === 'string' && (FEATURE_IDS as readonly string[]).includes(item))
}

export function toggleFeature(unlocked: string[], id: FeatureId): { unlocked: FeatureId[], enabled: boolean } {
  const current = new Set(parseUnlockedFeatures(unlocked))
  const enabled = !current.has(id)
  if (enabled) current.add(id)
  else current.delete(id)
  return { unlocked: [...current], enabled }
}
