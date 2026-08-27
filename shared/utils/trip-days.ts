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
