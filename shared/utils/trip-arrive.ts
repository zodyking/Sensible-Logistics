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
 * One plain sentence for the Arrive screen. Backend rules are unchanged:
 * swap empty finishes and the load stays live; customer/yard keep the box
 * on this service life; a marine or rail drop-off closes it.
 */
export function describeArrival(input: ArriveContext): string {
  const chassis = input.hasChassis
    ? (input.retainChassis === true
        ? ' Chassis stays on the box.'
        : input.retainChassis === false
          ? ' Chassis is unhooked here.'
          : '')
    : ''

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
