import { CONTAINER_TYPE_LABELS } from './domain'
import type { ContainerType, TripStatus } from './domain'
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

function actionLabel(action: TripSmsAction): 'Picked Up' | 'Dropped Off' {
  return action === 'pickup' ? 'Picked Up' : 'Dropped Off'
}

/**
 * Dispatch SMS body for the iOS share sheet.
 *
 * Seal is omitted for empty boxes. Pickup attaches photos/docs separately;
 * drop-off is text only.
 */
export function formatTripSmsMessage(action: TripSmsAction, input: TripSmsFields): string {
  const lines = [`${actionLabel(action)} ${loadWord(Boolean(input.isLoaded))}`]

  const container = formatContainerNumber(input.containerNumber || '') || input.containerNumber?.trim() || ''
  if (container) lines.push(`CT: ${container}`)

  const seal = input.sealNumber?.trim() || ''
  if (input.isLoaded && seal) lines.push(`Seal: ${seal}`)

  const chassis = formatChassisNumber(input.chassisNumber || '') || input.chassisNumber?.trim() || ''
  if (chassis) lines.push(`Chassis: ${chassis}`)

  if (input.containerType) lines.push(CONTAINER_TYPE_LABELS[input.containerType])

  const location = tripSmsLocationName(action, input)
  if (location) lines.push(`@${location}`)

  return lines.join('\n')
}
