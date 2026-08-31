import { calendarDateInZone } from './sms-task'
import { isNyNjBridgeCross, locationStateCode } from './us-address'

type DateInput = string | number | Date | null | undefined

export interface HomeTallyTrip {
  id: string
  createdAt: DateInput
  pickedUpAt?: DateInput
  droppedOffAt?: DateInput
  swapPairTripId?: string | null
  originState?: string | null
  originPostalCode?: string | null
  destinationState?: string | null
  destinationPostalCode?: string | null
}

export interface HomeDayTally {
  swaps: number
  bridgeCrosses: number
}

function toDate(value: DateInput): Date | null {
  if (value == null) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function onWorkDay(value: DateInput, iso: string, timeZone: string): boolean {
  const date = toDate(value)
  if (!date) return false
  return calendarDateInZone(date, timeZone) === iso
}

/** Created, picked up, or dropped off on this company calendar day. */
export function tripOnWorkDay(trip: HomeTallyTrip, iso: string, timeZone: string): boolean {
  return onWorkDay(trip.createdAt, iso, timeZone)
    || onWorkDay(trip.pickedUpAt, iso, timeZone)
    || onWorkDay(trip.droppedOffAt, iso, timeZone)
}

/**
 * Home masthead counts for one work day: unique swap pairs, and each
 * recorded dispatch whose origin and destination are NY and NJ (either way).
 */
export function countHomeDayTally(
  trips: HomeTallyTrip[],
  iso: string,
  timeZone: string,
): HomeDayTally {
  const swapKeys = new Set<string>()
  let bridgeCrosses = 0

  for (const trip of trips) {
    if (!tripOnWorkDay(trip, iso, timeZone)) continue

    if (trip.swapPairTripId) {
      swapKeys.add([trip.id, trip.swapPairTripId].sort().join(':'))
    }

    const origin = locationStateCode({
      state: trip.originState,
      postalCode: trip.originPostalCode,
    })
    const destination = locationStateCode({
      state: trip.destinationState,
      postalCode: trip.destinationPostalCode,
    })
    if (isNyNjBridgeCross(origin, destination)) bridgeCrosses += 1
  }

  return { swaps: swapKeys.size, bridgeCrosses }
}
