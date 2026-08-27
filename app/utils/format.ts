/** Presentation helpers. All stored values are UTC; formatting happens here. */

type DateInput = string | number | Date | null | undefined

function toDate(value: DateInput): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatTime(value: DateInput): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date)
}

export function formatDate(value: DateInput): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

export function formatDateTime(value: DateInput): string {
  const date = toDate(value)
  if (!date) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

/** `YYYY-MM-DD` work dates render without a timezone shift. */
export function formatWorkDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—'
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

/** Relative age used on list rows, e.g. `3h ago`. */
export function formatRelative(value: DateInput): string {
  const date = toDate(value)
  if (!date) return '—'

  const seconds = Math.round((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(date)
}

/** `7.8 h` — matches the ledger column in the design template. */
export function formatHours(minutes: number | null | undefined): string {
  if (minutes == null) return '—'
  return `${(minutes / 60).toFixed(1)} h`
}

/** Calendar day as UTC `YYYY-MM-DD`. */
export function toIsoDate(value: DateInput): string | null {
  const date = toDate(value)
  if (!date) return null
  return date.toISOString().slice(0, 10)
}

/** Monday (UTC) of the week containing an ISO date. */
export function startOfWeekMonday(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  const dow = date.getUTCDay()
  date.setUTCDate(date.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  return date
}

/** `Week of Aug 18 – Aug 24` */
export function formatWeekRange(isoDate: string): string {
  const start = startOfWeekMonday(isoDate)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 6)
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `Week of ${fmt.format(start)} – ${fmt.format(end)}`
}

/** `Today · Aug 24` / `Yesterday · Aug 23` / `Thursday · Aug 21` */
export function formatDayHeading(isoDate: string, todayIso = new Date().toISOString().slice(0, 10)): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  const pretty = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)
  if (isoDate === todayIso) return `Today · ${pretty}`
  const yesterday = new Date(`${todayIso}T00:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  if (isoDate === yesterday.toISOString().slice(0, 10)) return `Yesterday · ${pretty}`
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(date)
  return `${weekday} · ${pretty}`
}

/** Short ledger heading: `Mon 24` */
export function formatLedgerDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y!, m! - 1, d!)))
}

/** `06:42:11` running clock for the live on-duty elapsed readout. */
export function formatElapsedClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  return [hours, minutes, seconds].map(v => String(v).padStart(2, '0')).join(':')
}

/** Pulls a readable message out of an $fetch error. */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { statusMessage?: string, data?: { statusMessage?: string, message?: string } }
    return candidate.data?.statusMessage ?? candidate.data?.message ?? candidate.statusMessage ?? fallback
  }
  return fallback
}
