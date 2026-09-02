import type { EventType } from './domain'

/** Events a driver should see on trip and equipment history. */
export const DRIVER_TIMELINE_EVENT_TYPES = [
  'PICKUP_CONFIRMED',
  'DROPOFF_CONFIRMED',
  'CHASSIS_ATTACH',
  'CHASSIS_DETACH',
] as const

export type DriverTimelineEventType = (typeof DRIVER_TIMELINE_EVENT_TYPES)[number]

export const DRIVER_TIMELINE_TITLES: Record<DriverTimelineEventType, string> = {
  PICKUP_CONFIRMED: 'Picked up',
  DROPOFF_CONFIRMED: 'Dropped off',
  CHASSIS_ATTACH: 'Container placed on chassis',
  CHASSIS_DETACH: 'Container removed from chassis',
}

export type TimelineNodeKind = 'pickup' | 'dropoff' | 'attach' | 'detach'

export function isDriverTimelineEvent(eventType: EventType): eventType is DriverTimelineEventType {
  return (DRIVER_TIMELINE_EVENT_TYPES as readonly string[]).includes(eventType)
}

export function driverTimelineTitle(eventType: EventType): string {
  if (isDriverTimelineEvent(eventType)) return DRIVER_TIMELINE_TITLES[eventType]
  return eventType
}

export function timelineNodeKind(eventType: EventType): TimelineNodeKind {
  if (eventType === 'DROPOFF_CONFIRMED') return 'dropoff'
  if (eventType === 'CHASSIS_ATTACH') return 'attach'
  if (eventType === 'CHASSIS_DETACH') return 'detach'
  return 'pickup'
}

export interface TimelineSource {
  id: string
  eventType: EventType
  chassisNumber?: string | null
  payload?: Record<string, unknown> | null
}

/**
 * Keep pickups, drop-offs, and chassis hang/unhang. When older trips only
 * stored the chassis on the pickup or drop-off row, add the matching hang
 * or unhang so the rail still reads as equipment movement.
 */
export function visibleTimelineEntries<T extends TimelineSource>(entries: T[]): T[] {
  const hasDedicated = entries.some(entry =>
    entry.eventType === 'CHASSIS_ATTACH' || entry.eventType === 'CHASSIS_DETACH',
  )

  const out: T[] = []
  for (const entry of entries) {
    if (!isDriverTimelineEvent(entry.eventType)) continue
    out.push(entry)

    if (hasDedicated) continue

    if (entry.eventType === 'PICKUP_CONFIRMED' && entry.chassisNumber) {
      out.push({
        ...entry,
        id: `${entry.id}:attach`,
        eventType: 'CHASSIS_ATTACH',
      })
    }

    if (entry.eventType === 'DROPOFF_CONFIRMED' && shouldSynthesizeDetach(entry)) {
      out.push({
        ...entry,
        id: `${entry.id}:detach`,
        eventType: 'CHASSIS_DETACH',
      })
    }
  }
  return out
}

function shouldSynthesizeDetach(entry: TimelineSource): boolean {
  const retain = entry.payload?.retainChassis
  if (retain === true) return false
  if (retain === false) return true
  return false
}

/** Driver notes only — skip system chatter that used to crowd the rail. */
export function timelineNote(notes: string | null | undefined): string | null {
  const text = notes?.trim()
  if (!text) return null
  if (/^driver cancelled/i.test(text)) return null
  if (/final release/i.test(text)) return null
  if (/chassis released so/i.test(text)) return null
  return text
}
