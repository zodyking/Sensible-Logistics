import { formatContainerNumber } from './iso6346'

/** Driver-facing copy when a scanned box is still on a live movement. */
export function driverHoldPrompt(
  driverName: string | null | undefined,
  containerNumber?: string | null,
): string {
  const name = driverName?.trim() || 'Another driver'
  const box = formatContainerNumber(containerNumber ?? '') || containerNumber?.trim() || 'this container'
  return `${name} currently has ${box}. Release it and add it here?`
}

export function containerIsHeldByDriver(state: string | null | undefined): boolean {
  return state === 'PICKUP_IN_PROGRESS' || state === 'DRIVER_CUSTODY'
}

/** Resolve must surface a hold from pool state alone — currentDriverId can be missing. */
export function resolutionReportsDriverHold(state: string | null | undefined): boolean {
  return containerIsHeldByDriver(state)
}
