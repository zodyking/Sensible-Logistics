import { formatChassisNumber, formatContainerNumber } from './iso6346'

export interface TripEquipmentTitleInput {
  kind?: string | null
  containerNumber?: string | null
  chassisNumber?: string | null
  reference?: string | null
}

function trimmed(value?: string | null): string {
  return value?.trim() || ''
}

/** Chassis-only movements, including rows that lost a container join. */
export function isBareChassisTrip(input: Pick<TripEquipmentTitleInput, 'kind' | 'containerNumber' | 'chassisNumber'>): boolean {
  return input.kind === 'BARE_CHASSIS' || (!trimmed(input.containerNumber) && Boolean(trimmed(input.chassisNumber)))
}

/**
 * Bold label on trip cards and the trip record: container number, else chassis
 * number, else the trip reference. Chassis-only trips never lead with `TRP-*`
 * when a chassis number is known.
 */
export function tripEquipmentTitle(input: TripEquipmentTitleInput): string {
  const container = trimmed(input.containerNumber)
  const chassis = trimmed(input.chassisNumber)
  const reference = trimmed(input.reference)
  const formattedChassis = chassis ? (formatChassisNumber(chassis) || chassis) : ''

  if (isBareChassisTrip(input)) {
    return formattedChassis || reference || 'Chassis'
  }
  if (container) return formatContainerNumber(container) || container
  if (formattedChassis) return formattedChassis
  return reference || 'Trip'
}

/** Overlay chassis numbers recovered from events onto trips that dropped the join. */
export function applyBareChassisNumbers<T extends { id: string, kind?: string | null, chassisNumber?: string | null }>(
  items: T[],
  numbersByTripId: ReadonlyMap<string, string>,
): T[] {
  return items.map((item) => {
    if (trimmed(item.chassisNumber)) return item
    if (item.kind !== 'BARE_CHASSIS') return item
    const number = numbersByTripId.get(item.id)
    if (!number) return item
    return { ...item, chassisNumber: number }
  })
}

/** First chassis number per trip from events already ordered newest first. */
export function latestChassisNumberByTrip(
  rows: Array<{ tripId?: string | null, chassisNumber?: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const row of rows) {
    const tripId = trimmed(row.tripId)
    const number = trimmed(row.chassisNumber)
    if (!tripId || !number || map.has(tripId)) continue
    map.set(tripId, number)
  }
  return map
}
