import type { LocationType, TripKind } from './domain'

export interface ArriveContext {
  kind?: TripKind | string | null
  isLoaded?: boolean | null
  swapPairTripId?: string | null
  locationType?: LocationType | null
  hasChassis?: boolean
  retainChassis?: boolean | null
}

/** Empty inbound of a customer swap — Arrive completes it and leaves the load. */
export function isSwapEmptyArrival(input: ArriveContext): boolean {
  return Boolean(
    input.swapPairTripId
    && !input.isLoaded
    && input.kind !== 'BARE_CHASSIS',
  )
}

/**
 * One plain sentence for the Arrive screen. A container with a chassis
 * offers drop-both (chassis stays on the box) or drop-container-only
 * (driver keeps the chassis and Home opens a chassis-only trip).
 */
export function describeArrival(input: ArriveContext): string {
  const chassis = describeArrivalChassis(input)

  if (isSwapEmptyArrival(input)) {
    return `This finishes the empty at the customer. The load stays on Home.${chassis}`
  }

  if (input.kind === 'BARE_CHASSIS') {
    if (input.retainChassis === true) {
      return 'The chassis stays assigned at this location. This trip ends.'
    }
    if (input.retainChassis === false) {
      return 'The chassis is parked here. This trip ends.'
    }
    return 'This trip ends here.'
  }

  switch (input.locationType) {
    case 'CUSTOMER':
      return `The container stays at the customer to load. This trip ends.${chassis}`
    case 'COMPANY_YARD':
      return `Yard stop. The container stays here. This trip ends.${chassis}`
    case 'MARINE_TERMINAL':
    case 'RAIL_TERMINAL':
      return `The container is returned. This trip ends.${chassis}`
    default:
      return `This trip ends here.${chassis}`
  }
}

/** True when Arrive should leave the box and keep the chassis with the driver. */
export function keepsChassisAfterContainerDrop(input: ArriveContext): boolean {
  return Boolean(
    input.hasChassis
    && input.kind !== 'BARE_CHASSIS'
    && input.retainChassis === false,
  )
}

function describeArrivalChassis(input: ArriveContext): string {
  if (!input.hasChassis || input.kind === 'BARE_CHASSIS') return ''
  if (input.retainChassis === true) return ' Container and chassis stay here.'
  if (input.retainChassis === false) {
    return ' You keep the chassis. Home will open a chassis-only trip so you can set the next drop-off.'
  }
  return ''
}
