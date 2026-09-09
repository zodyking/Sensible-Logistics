import type { DispatchTaskKind } from './domain'
import { composeDispatchCardText, emptyDispatchCard } from './dispatch-cards'

export interface DispatchTaskComposeInput {
  kind: DispatchTaskKind
  containerNumber: string
  locationName: string
  notes?: string | null
}

/** Dispatcher blob a driver can open from Tasks. */
export function composeDispatchTaskText(input: DispatchTaskComposeInput): string {
  const card = emptyDispatchCard(input.kind)
  card.containerNumber = input.containerNumber.trim()
  card.locationName = input.locationName.trim() || 'the yard'
  card.notes = input.notes?.trim() ?? ''
  return composeDispatchCardText(card)
}
