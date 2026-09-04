import { toLocalIsoDate } from './trip-days'
import {
  isServiceTerminus,
  sliceCurrentServiceLife,
  summarizeServiceLife,
  type ServiceLifeEvent,
} from './service-life'

export interface Occupancy {
  pickedUpAt: string
  daysOld: number
  daysLabel: string
  pickedUpLabel: string
}

function toDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Local `MM/DD/YY` so occupancy fits the top-right of a location card. */
export function formatSlashDate(value: Date | string): string {
  const date = toDate(value)
  if (!date) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  return `${month}/${day}/${year}`
}

/** Whole local calendar days since the terminal pull (0 = pulled today). */
export function calendarDaysOld(from: Date | string, now: Date | string = new Date()): number {
  const startIso = toLocalIsoDate(from)
  const endIso = toLocalIsoDate(now)
  if (!startIso || !endIso) return 0
  const [sy, sm, sd] = startIso.split('-').map(Number)
  const [ey, em, ed] = endIso.split('-').map(Number)
  const start = Date.UTC(sy!, sm! - 1, sd)
  const end = Date.UTC(ey!, em! - 1, ed)
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

/**
 * First marine/rail pickup of the current open service life.
 * Returns null after a terminal return or when that pull was never recorded.
 */
export function occupancyPickupAt(events: ServiceLifeEvent[]): Date | string | null {
  const sliced = sliceCurrentServiceLife(events)
  if (summarizeServiceLife(sliced).status === 'COMPLETE') return null

  const pulls = sliced
    .filter(event => event.eventType === 'PICKUP_CONFIRMED' && isServiceTerminus(event.locationType))
    .slice()
    .sort((a, b) => {
      const aTime = toDate(a.occurredAt)?.getTime() ?? 0
      const bTime = toDate(b.occurredAt)?.getTime() ?? 0
      return aTime - bTime
    })

  return pulls[0]?.occurredAt ?? null
}

export function occupancyFromEvents(
  events: ServiceLifeEvent[],
  now: Date | string = new Date(),
): Occupancy | null {
  const pickedUpAt = occupancyPickupAt(events)
  if (!pickedUpAt) return null
  const stamp = toDate(pickedUpAt)
  if (!stamp) return null
  const daysOld = calendarDaysOld(stamp, now)
  return {
    pickedUpAt: stamp.toISOString(),
    daysOld,
    daysLabel: daysOld === 1 ? '1 day old' : `${daysOld} days old`,
    pickedUpLabel: `picked up ${formatSlashDate(stamp)}`,
  }
}
