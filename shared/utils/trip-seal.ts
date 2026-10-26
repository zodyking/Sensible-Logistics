import { isLiveTripStatus } from './domain'

/** Two taps inside this window open the seal editor. */
export const SEAL_DOUBLE_TAP_MS = 350

/** Loaded container on a live pickup or drop-off. */
export function canEditTripSeal(input: {
  kind?: string | null
  status?: string | null
  isLoaded?: boolean | null
}): boolean {
  if (input.kind === 'BARE_CHASSIS') return false
  if (!isLiveTripStatus(input.status)) return false
  return input.isLoaded === true
}

export function isSealDoubleTap(previousAt: number | null | undefined, now: number): boolean {
  return previousAt != null && now - previousAt <= SEAL_DOUBLE_TAP_MS
}
