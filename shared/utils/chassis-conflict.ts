import { formatContainerNumber } from './iso6346'

/**
 * True when a scanned/typed chassis is already under a different container
 * than the one this pickup or add-equipment flow is about.
 */
export function chassisNeedsRelease(
  currentContainerId: string | null | undefined,
  keepContainerId?: string | null,
): boolean {
  if (!currentContainerId) return false
  if (keepContainerId && currentContainerId === keepContainerId) return false
  return true
}

/** Driver-facing copy for the release confirmation sheet. */
export function chassisInUsePrompt(containerNumber: string | null | undefined): string {
  const label = formatContainerNumber(containerNumber ?? '') || containerNumber?.trim() || 'another container'
  return `This chassis is attached to container number ${label} already. Would you like to release it?`
}
