/**
 * Structured dispatch cards for the desk editor and the driver viewer.
 * One card is one stop of work for a calendar day.
 */

import { DISPATCH_TASK_KIND_LABELS, DISPATCH_TASK_KINDS, type DispatchTaskKind } from './domain'
import { formatContainerNumber, normalizeContainerNumber } from './iso6346'
import { emptyStep, firstLineTitle, type TaskStep } from './task-steps'

export interface DispatchCard {
  id: string
  kind: DispatchTaskKind
  notes: string
  locationId: string | null
  locationName: string
  destinationLocationId: string | null
  destinationLocationName: string
  containerId: string | null
  containerNumber: string
  containerPending: boolean
}

function newCardId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `c-${Math.random().toString(36).slice(2, 12)}`
}

export function emptyDispatchCard(kind: DispatchTaskKind = 'PICKUP'): DispatchCard {
  return {
    id: newCardId(),
    kind,
    notes: '',
    locationId: null,
    locationName: '',
    destinationLocationId: null,
    destinationLocationName: '',
    containerId: null,
    containerNumber: '',
    containerPending: false,
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asKind(value: unknown): DispatchTaskKind {
  return DISPATCH_TASK_KINDS.includes(value as DispatchTaskKind) ? value as DispatchTaskKind : 'NOTE'
}

export function normalizeDispatchCard(value: unknown): DispatchCard | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<DispatchCard>
  const id = asString(row.id) || newCardId()
  const number = normalizeContainerNumber(asString(row.containerNumber))
  return {
    id,
    kind: asKind(row.kind),
    notes: asString(row.notes),
    locationId: asId(row.locationId),
    locationName: asString(row.locationName),
    destinationLocationId: asId(row.destinationLocationId),
    destinationLocationName: asString(row.destinationLocationName),
    containerId: asId(row.containerId),
    containerNumber: number,
    containerPending: row.containerPending === true || (!row.containerId && Boolean(number)),
  }
}

export function isDispatchCardComplete(card: DispatchCard): boolean {
  return Boolean(
    card.containerNumber
    || card.locationName
    || card.destinationLocationName
    || card.notes,
  )
}

export function displayContainerNumber(number: string | null | undefined): string {
  const raw = (number ?? '').trim()
  if (!raw) return ''
  return formatContainerNumber(raw) || raw.toUpperCase()
}

export function composeDispatchCardText(card: DispatchCard): string {
  const kind = DISPATCH_TASK_KIND_LABELS[card.kind]
  const box = displayContainerNumber(card.containerNumber)
  const from = card.locationName.trim()
  const to = card.destinationLocationName.trim()
  const lines: string[] = []

  if (box) lines.push(`${kind} ${box}`)
  else lines.push(kind)

  if (from && to && from !== to) lines.push(`${from} → ${to}`)
  else if (to) lines.push(`To ${to}`)
  else if (from) lines.push(from)

  if (card.containerPending && box) lines.push('Container not in the yard yet')
  const notes = card.notes.trim()
  if (notes) lines.push(notes)
  return lines.join('\n')
}

export function dispatchCardTitle(card: DispatchCard): string {
  const box = displayContainerNumber(card.containerNumber)
  if (box) return `${DISPATCH_TASK_KIND_LABELS[card.kind]} ${box}`
  const place = card.locationName.trim() || card.destinationLocationName.trim()
  if (place) return `${DISPATCH_TASK_KIND_LABELS[card.kind]} · ${place}`
  const notes = card.notes.trim()
  if (notes) return firstLineTitle(notes, DISPATCH_TASK_KIND_LABELS[card.kind])
  return DISPATCH_TASK_KIND_LABELS[card.kind]
}

export function stepsForDispatchCard(card: DispatchCard, existing?: TaskStep[]): TaskStep[] {
  const text = composeDispatchCardText(card)
  const prior = existing?.[0]
  return [{
    id: prior?.id || emptyStep(text).id,
    text,
    done: prior?.done === true,
  }]
}

export function cardFromTask(input: {
  id: string
  kind: DispatchTaskKind
  rawText: string
  parsed?: Record<string, unknown> | null
}): DispatchCard {
  const parsed = input.parsed ?? {}
  const nested = (parsed.card && typeof parsed.card === 'object')
    ? parsed.card as Record<string, unknown>
    : parsed
  const fromParsed = normalizeDispatchCard({
    id: input.id,
    kind: nested.kind ?? input.kind,
    notes: nested.notes,
    locationId: nested.locationId ?? parsed.locationId,
    locationName: nested.locationName ?? parsed.locationName,
    destinationLocationId: nested.destinationLocationId,
    destinationLocationName: nested.destinationLocationName,
    containerId: nested.containerId,
    containerNumber: nested.containerNumber
      ?? (Array.isArray(parsed.containerNumbers) ? parsed.containerNumbers[0] : ''),
    containerPending: nested.containerPending,
  })
  if (fromParsed && (fromParsed.containerNumber || fromParsed.locationName || fromParsed.notes)) {
    return { ...fromParsed, id: input.id, kind: input.kind }
  }
  return {
    ...emptyDispatchCard(input.kind),
    id: input.id,
    notes: input.rawText.trim(),
  }
}

export function parsedFromDispatchCard(
  card: DispatchCard,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    origin: 'dispatch',
    containerNumbers: card.containerNumber ? [card.containerNumber] : [],
    locationId: card.locationId,
    locationName: card.locationName || null,
    assignedByUserId: extra.assignedByUserId ?? null,
    card: {
      kind: card.kind,
      notes: card.notes,
      locationId: card.locationId,
      locationName: card.locationName,
      destinationLocationId: card.destinationLocationId,
      destinationLocationName: card.destinationLocationName,
      containerId: card.containerId,
      containerNumber: card.containerNumber,
      containerPending: card.containerPending,
    },
    steps: extra.steps ?? stepsForDispatchCard(card),
  }
}

/** Drivers may toggle done on assigned cards but cannot rewrite the wording. */
export function applyAssignedStepPatch(existing: TaskStep[], incoming: TaskStep[]): TaskStep[] {
  const byId = new Map(incoming.map(step => [step.id, step]))
  return existing.map(step => ({
    ...step,
    done: byId.get(step.id)?.done ?? step.done,
  }))
}

export function isAssignedTaskSource(source: string | null | undefined): boolean {
  return source === 'DISPATCH' || source === 'SMS'
}
