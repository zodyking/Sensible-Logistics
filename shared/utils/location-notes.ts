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
