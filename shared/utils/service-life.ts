/**
 * Container and chassis service-life rules.
 *
 * A service life starts at a marine terminal or rail yard, may stop at a
 * company yard or customer, and only completes when the equipment is dropped
 * back at a marine terminal or rail yard. Company-yard stops never close it.
 * A customer drop-off sets container status to Loading.
 */

import type { ContainerStatus, EventType, LocationType } from './domain'

/** Confirmed pickup / drop-off events that belong on an equipment record. */
export const SERVICE_RECORD_EVENT_TYPES = [
  'PICKUP_CONFIRMED',
  'DROPOFF_CONFIRMED',
] as const

export type ServiceRecordEventType = (typeof SERVICE_RECORD_EVENT_TYPES)[number]

export const SERVICE_RECORD_LABELS: Record<ServiceRecordEventType, string> = {
  PICKUP_CONFIRMED: 'Picked up',
  DROPOFF_CONFIRMED: 'Dropped off',
}

export const SERVICE_TERMINUS_TYPES = ['MARINE_TERMINAL', 'RAIL_TERMINAL'] as const
export type ServiceTerminusType = (typeof SERVICE_TERMINUS_TYPES)[number]

export const CUSTOMER_LOADING_TYPES = ['CUSTOMER'] as const
export type CustomerLoadingType = (typeof CUSTOMER_LOADING_TYPES)[number]

export interface ServiceLifeEvent {
  eventType: EventType
  occurredAt: Date | string
  tripId?: string | null
  locationType?: LocationType | null
}

export function isServiceRecordEvent(eventType: EventType): eventType is ServiceRecordEventType {
  return (SERVICE_RECORD_EVENT_TYPES as readonly string[]).includes(eventType)
}

export function isServiceTerminus(type: LocationType | null | undefined): boolean {
  return type === 'MARINE_TERMINAL' || type === 'RAIL_TERMINAL'
}

export function isCustomerLoadingSite(type: LocationType | null | undefined): boolean {
  return type === 'CUSTOMER'
}

export function isCompanyYard(type: LocationType | null | undefined): boolean {
  return type === 'COMPANY_YARD'
}

/** Drop-off at a marine terminal or rail yard ends the current service life. */
export function dropoffCompletesServiceLife(type: LocationType | null | undefined): boolean {
  return isServiceTerminus(type)
}

/**
 * Container status after a completed drop-off at this location.
 * In-transit status is applied on pickup confirm, not here.
 */
export function containerStatusAfterDropoff(type: LocationType | null | undefined): ContainerStatus {
  if (dropoffCompletesServiceLife(type)) return 'RETURNED'
  if (isCustomerLoadingSite(type)) return 'LOADING'
  if (isCompanyYard(type)) return 'AT_YARD'
  return 'AVAILABLE'
}

export function describeDropoffEffect(type: LocationType | null | undefined): string {
  if (dropoffCompletesServiceLife(type)) {
    return 'This drop-off completes the service life. The container returns to the Marine Terminal or Rail Yard.'
  }
  if (isCustomerLoadingSite(type)) {
    return 'The container stays on this service life and its status becomes Loading.'
  }
  if (isCompanyYard(type)) {
    return 'Company Yard is an intermediate stop. The service life stays open until a Marine Terminal or Rail Yard drop-off.'
  }
  return 'This stop stays on the current service life. It completes only at a Marine Terminal or Rail Yard.'
}

function isCompletingDropoff(event: ServiceLifeEvent): boolean {
  return event.eventType === 'DROPOFF_CONFIRMED' && dropoffCompletesServiceLife(event.locationType)
}

function occurredTime(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

const EVENT_ORDER: Record<ServiceRecordEventType, number> = {
  PICKUP_CONFIRMED: 0,
  DROPOFF_CONFIRMED: 1,
}

/** Newest-first rail: movement first, then hang/unhang at the same stamp. */
const DISPLAY_ORDER: Record<string, number> = {
  DROPOFF_CONFIRMED: 0,
  CHASSIS_DETACH: 1,
  PICKUP_CONFIRMED: 2,
  CHASSIS_ATTACH: 3,
}

function eventOrder(eventType: EventType): number {
  return isServiceRecordEvent(eventType) ? EVENT_ORDER[eventType] : 99
}

function displayOrder(eventType: EventType): number {
  return DISPLAY_ORDER[eventType] ?? 50
}

function compareEvents(a: ServiceLifeEvent, b: ServiceLifeEvent): number {
  const byTime = occurredTime(a.occurredAt) - occurredTime(b.occurredAt)
  return byTime !== 0 ? byTime : eventOrder(a.eventType) - eventOrder(b.eventType)
}

/**
 * Keep one service life: events after the previous completing terminal
 * drop-off, through the current open run or the latest completed return.
 */
export function sliceCurrentServiceLife<T extends ServiceLifeEvent>(events: T[]): T[] {
  const movement = events
    .filter(event =>
      isServiceRecordEvent(event.eventType)
      || event.eventType === 'CHASSIS_ATTACH'
      || event.eventType === 'CHASSIS_DETACH',
    )
    .slice()
    .sort(compareEvents)

  const lives: T[][] = []
  let current: T[] = []

  for (const event of movement) {
    current.push(event)
    if (isCompletingDropoff(event)) {
      lives.push(current)
      current = []
    }
  }
  if (current.length) lives.push(current)

  const latest = lives.at(-1) ?? []
  return latest.sort((a, b) => {
    const byTime = occurredTime(b.occurredAt) - occurredTime(a.occurredAt)
    return byTime !== 0 ? byTime : displayOrder(a.eventType) - displayOrder(b.eventType)
  })
}

export interface ServiceLifeSummary {
  status: 'OPEN' | 'COMPLETE'
  startedAt: Date | string | null
  completedAt: Date | string | null
  originType: LocationType | null
}

export function summarizeServiceLife(eventsNewestFirst: ServiceLifeEvent[]): ServiceLifeSummary {
  const chronological = eventsNewestFirst
    .filter(event => event.eventType === 'PICKUP_CONFIRMED' || event.eventType === 'DROPOFF_CONFIRMED')
    .slice()
    .sort(compareEvents)

  const first = chronological[0]
  const last = chronological.at(-1)

  return {
    status: last && isCompletingDropoff(last) ? 'COMPLETE' : 'OPEN',
    startedAt: first?.occurredAt ?? null,
    completedAt: last && isCompletingDropoff(last) ? last.occurredAt : null,
    originType: first?.locationType ?? null,
  }
}
