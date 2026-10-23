export const LOCATION_NOTE_TTL_MONTHS = 1
export const LOCATION_NOTE_MAX = 40
export const LOCATION_NOTE_BODY_MAX = 800

/** One calendar month after the note was left. */
export function locationNoteExpiresAt(createdAt: Date): Date {
  const expires = new Date(createdAt.getTime())
  expires.setUTCMonth(expires.getUTCMonth() + LOCATION_NOTE_TTL_MONTHS)
  return expires
}

export function locationNoteIsLive(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() > now.getTime()
}

export type LocationNoteAuthor = {
  firstName?: string | null
  lastName?: string | null
  fullName?: string | null
}

export function locationNoteAuthorName(user: LocationNoteAuthor): string {
  const full = user.fullName?.trim()
  if (full) return full
  return [user.firstName, user.lastName].filter(part => part?.trim()).join(' ').trim() || 'Someone'
}

/** Step through a review deck. Stops at the ends instead of wrapping. */
export function locationNoteReviewIndex(current: number, total: number, step: 1 | -1): number {
  if (total <= 0) return 0
  return Math.min(total - 1, Math.max(0, current + step))
}
