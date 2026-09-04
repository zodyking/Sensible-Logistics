/** Driver-facing copy when a scanned box is still on a live movement. */
export function driverHoldPrompt(driverName: string | null | undefined): string {
  const name = driverName?.trim() || 'a driver'
  return `This container is attached to ${name}. Would you like to release it?`
}

export function containerIsHeldByDriver(state: string | null | undefined): boolean {
  return state === 'PICKUP_IN_PROGRESS' || state === 'DRIVER_CUSTODY'
}
