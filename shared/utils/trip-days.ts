/**
 * Local-calendar helpers for trip history. Pickup and drop-off timestamps are
 * stored in UTC; grouping and the month grid use the viewer's local day.
 */

type DateInput = string | number | Date | null | undefined

export interface TripDayStamps {
  createdAt: DateInput
  pickedUpAt?: DateInput
  droppedOffAt?: DateInput
}

function toDate(value: DateInput): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Local calendar day as `YYYY-MM-DD`. */
export function toLocalIsoDate(value: DateInput): string | null {
  const date = toDate(value)
  if (!date) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Pickup day, falling back to when the trip was opened. */
export function tripPickupDay(trip: TripDayStamps): string | null {
  return toLocalIsoDate(trip.pickedUpAt ?? trip.createdAt)
}

/** Distinct local days this trip was picked up or dropped off. */
export function tripActivityDays(trip: TripDayStamps): string[] {
  const days = new Set<string>()
  const pickup = tripPickupDay(trip)
  const dropoff = toLocalIsoDate(trip.droppedOffAt)
  if (pickup) days.add(pickup)
  if (dropoff) days.add(dropoff)
  return [...days]
}

export function tripOccursOnDay(trip: TripDayStamps, iso: string): boolean {
  return tripActivityDays(trip).includes(iso)
}

export interface DayWorkTrip {
  id: string
  pickedUpAt?: DateInput
  droppedOffAt?: DateInput
  swapPairTripId?: string | null
}

export interface DayWorkCounts {
  swaps: number
  pickups: number
  dropoffs: number
}

/** Pickups, drop-offs, and unique swap pairs that happened on a local day. */
export function countDayWork(trips: DayWorkTrip[], iso: string): DayWorkCounts {
  let pickups = 0
  let dropoffs = 0
  const swapKeys = new Set<string>()

  for (const trip of trips) {
    const pickupDay = toLocalIsoDate(trip.pickedUpAt)
    const dropoffDay = toLocalIsoDate(trip.droppedOffAt)
    if (pickupDay === iso) pickups += 1
    if (dropoffDay === iso) dropoffs += 1
    if (!trip.swapPairTripId) continue
    if (pickupDay !== iso && dropoffDay !== iso) continue
    const key = [trip.id, trip.swapPairTripId].sort().join(':')
    swapKeys.add(key)
  }

  return { swaps: swapKeys.size, pickups, dropoffs }
}

export function formatDayWorkSummary(counts: DayWorkCounts): string {
  const parts: string[] = []
  if (counts.swaps) parts.push(counts.swaps === 1 ? '1 swap' : `${counts.swaps} swaps`)
  if (counts.pickups) parts.push(counts.pickups === 1 ? '1 pickup' : `${counts.pickups} pickups`)
  if (counts.dropoffs) parts.push(counts.dropoffs === 1 ? '1 drop-off' : `${counts.dropoffs} drop-offs`)
  return parts.join(' · ')
}
