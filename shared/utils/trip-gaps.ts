/**
 * Detect a broken hop between consecutive trips: the prior drop-off is not
 * the next pickup. Clean history chains destination → origin; a break is
 * either a missing trip or a confirmed bobtail (tractor only).
 */

type DateInput = string | number | Date | null | undefined

export const GAP_RESOLUTIONS = ['MISSING', 'BOBTAIL'] as const
export type GapResolution = (typeof GAP_RESOLUTIONS)[number]

export interface TripLink {
  id: string
  createdAt: DateInput
  pickedUpAt?: DateInput | null
  originLocationId?: string | null
  destinationLocationId?: string | null
  originName?: string | null
  destinationName?: string | null
}

export interface TripGap {
  key: string
  priorTripId: string
  nextTripId: string
  fromLocationId: string | null
  fromName: string
  toLocationId: string | null
  toName: string
}

export interface TripGapResolution {
  priorTripId: string
  nextTripId: string
  resolution: GapResolution
}

export type TripListRow<T>
  = | { kind: 'trip', trip: T }
    | { kind: 'gap', gap: TripGap }

export function gapKey(priorTripId: string, nextTripId: string): string {
  return `${priorTripId}:${nextTripId}`
}

/** Lower-cased place name used when a location id is missing. */
export function normalizePlace(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function samePlace(
  a: { id?: string | null, name?: string | null },
  b: { id?: string | null, name?: string | null },
): boolean {
  if (a.id && b.id) return a.id === b.id
  const left = normalizePlace(a.name)
  const right = normalizePlace(b.name)
  return Boolean(left && right && left === right)
}

function tripTime(trip: TripLink): number {
  const stamp = trip.pickedUpAt ?? trip.createdAt
  if (stamp instanceof Date) return stamp.getTime()
  if (stamp == null) return 0
  const date = new Date(stamp)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function placeName(value: string | null | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? ''
  return trimmed || fallback
}

/** Oldest → newest gaps where prior destination ≠ next origin. */
export function findTripGaps(trips: readonly TripLink[]): TripGap[] {
  const ordered = [...trips].sort((a, b) => {
    const delta = tripTime(a) - tripTime(b)
    return delta !== 0 ? delta : a.id.localeCompare(b.id)
  })

  const gaps: TripGap[] = []
  for (let i = 1; i < ordered.length; i++) {
    const prior = ordered[i - 1]!
    const next = ordered[i]!
    const fromId = prior.destinationLocationId ?? null
    const toId = next.originLocationId ?? null
    const fromName = prior.destinationName?.trim() ?? ''
    const toName = next.originName?.trim() ?? ''
    if (!fromId && !fromName) continue
    if (!toId && !toName) continue
    if (samePlace({ id: fromId, name: fromName }, { id: toId, name: toName })) continue
    gaps.push({
      key: gapKey(prior.id, next.id),
      priorTripId: prior.id,
      nextTripId: next.id,
      fromLocationId: fromId,
      fromName: placeName(fromName, 'Unknown stop'),
      toLocationId: toId,
      toName: placeName(toName, 'Unknown stop'),
    })
  }
  return gaps
}

export function resolutionMap(
  rows: readonly TripGapResolution[] | null | undefined,
): Map<string, GapResolution> {
  const map = new Map<string, GapResolution>()
  for (const row of rows ?? []) {
    map.set(gapKey(row.priorTripId, row.nextTripId), row.resolution)
  }
  return map
}

/**
 * Insert a gap card immediately before the later trip so a chronological
 * list reads: prior drop-off → (missing / bobtail) → next origin.
 */
export function weaveGapsIntoTrips<T extends { id: string }>(
  trips: readonly T[],
  gaps: readonly TripGap[],
): TripListRow<T>[] {
  const byNext = new Map(gaps.map(gap => [gap.nextTripId, gap]))
  const rows: TripListRow<T>[] = []
  for (const trip of trips) {
    const gap = byNext.get(trip.id)
    if (gap) rows.push({ kind: 'gap', gap })
    rows.push({ kind: 'trip', trip })
  }
  return rows
}
