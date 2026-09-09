import { DISPATCH_TASK_KIND_LABELS, type DispatchTaskKind } from './domain'
import { formatContainerNumber } from './iso6346'

export interface DispatchTaskComposeInput {
  kind: DispatchTaskKind
  containerNumber: string
  locationName: string
  notes?: string | null
}

/** One-line dispatcher blob a driver can open from Tasks. */
export function composeDispatchTaskText(input: DispatchTaskComposeInput): string {
  const box = formatContainerNumber(input.containerNumber) || input.containerNumber.trim()
  const place = input.locationName.trim() || 'the yard'
  const lines = [`${DISPATCH_TASK_KIND_LABELS[input.kind]} ${box} at ${place}`]
  const notes = input.notes?.trim()
  if (notes) lines.push(notes)
  return lines.join('\n')
}
