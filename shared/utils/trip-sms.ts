import { CONTAINER_TYPE_LABELS } from './domain'
import type { ContainerType, LocationType, TripStatus } from './domain'
import { formatChassisNumber, formatContainerNumber } from './iso6346'

export type TripSmsAction = 'pickup' | 'dropoff'

export interface TripSmsFields {
  isLoaded: boolean
  containerNumber?: string | null
  sealNumber?: string | null
  chassisNumber?: string | null
  containerType?: ContainerType | null
  originName?: string | null
  destinationName?: string | null
  customer?: string | null
}

/**
 * Pickup SMS after confirm; drop-off SMS after arrive. Later statuses keep the
 * drop-off wording so a driver can resend from Home or trip details.
 */
export function tripSmsAction(status: TripStatus | null | undefined): TripSmsAction | null {
  switch (status) {
    case 'IN_TRANSIT':
    case 'DROPOFF_IN_PROGRESS':
      return 'pickup'
    case 'DROPPED_OFF':
    case 'COMPLETED':
      return 'dropoff'
    default:
      return null
  }
}

export function tripSmsLocationName(
  action: TripSmsAction,
  input: Pick<TripSmsFields, 'originName' | 'destinationName' | 'customer'>,
): string {
  const origin = input.originName?.trim() || ''
  const destination = input.destinationName?.trim() || ''
  const customer = input.customer?.trim() || ''
  if (action === 'pickup') return origin || customer || destination
  return destination || customer || origin
}

function loadWord(isLoaded: boolean): 'Load' | 'Empty' {
  return isLoaded ? 'Load' : 'Empty'
}

function actionLine(action: TripSmsAction, isLoaded: boolean): string {
  return action === 'pickup'
    ? `Picked Up ${loadWord(isLoaded)} ⬆️`
    : `Dropped ${loadWord(isLoaded)} ⬇️`
}

function typeLine(containerType?: ContainerType | null): string | null {
  if (!containerType) return null
  return `${CONTAINER_TYPE_LABELS[containerType]} Container`
}

function smsBodyLines(action: TripSmsAction, input: TripSmsFields): string[] {
  const lines = [actionLine(action, Boolean(input.isLoaded))]

  const container = formatContainerNumber(input.containerNumber || '') || input.containerNumber?.trim() || ''
  if (container) lines.push(`CT: ${container}`)

  const seal = input.sealNumber?.trim() || ''
  if (input.isLoaded && seal) lines.push(`Seal: ${seal}`)

  const chassis = formatChassisNumber(input.chassisNumber || '') || input.chassisNumber?.trim() || ''
  if (chassis) lines.push(`Chassis: ${chassis}`)

  const location = tripSmsLocationName(action, input)
  if (location) lines.push(`@${location}`)

  const type = typeLine(input.containerType)
  if (type) lines.push(type)

  return lines
}

/**
 * Dispatch SMS body for the iOS share sheet.
 *
 * Seal is omitted for empty boxes. Pickup attaches photos/docs separately;
 * drop-off is text only unless a swap is in progress.
 */
export function formatTripSmsMessage(action: TripSmsAction, input: TripSmsFields): string {
  return smsBodyLines(action, input).join('\n')
}

/**
 * Two-container swap SMS: the load leaving the customer, then the empty left
 * behind. Photos and documents from both boxes attach with the send.
 */
export function formatSwapSmsMessage(picked: TripSmsFields, dropped: TripSmsFields): string {
  return [
    'Swap 🔁',
    '',
    ...smsBodyLines('pickup', { ...picked, isLoaded: true }),
    '',
    ...smsBodyLines('dropoff', { ...dropped, isLoaded: false }),
  ].join('\n')
}

/** Empty inbound to a customer can open a second pickup for the outbound load. */
export function canStartSwap(input: {
  status?: TripStatus | null
  isLoaded?: boolean | null
  destinationType?: LocationType | null
  swapPairTripId?: string | null
  kind?: string | null
}): boolean {
  if (input.swapPairTripId) return false
  if (input.kind === 'BARE_CHASSIS') return false
  if (input.isLoaded) return false
  if (input.destinationType !== 'CUSTOMER') return false
  return input.status === 'IN_TRANSIT' || input.status === 'DROPOFF_IN_PROGRESS'
}
