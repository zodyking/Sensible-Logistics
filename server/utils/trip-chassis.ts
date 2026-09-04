import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { chassis, containerEvents } from '../database/schema'
import type { DbExecutor } from './db'
import { latestChassisNumberByTrip } from '#shared/utils/trip-title'

/** Chassis numbers from pickup/drop-off events when `trips.chassis_id` was cleared. */
export async function chassisNumbersFromEvents(
  db: DbExecutor,
  companyId: string,
  tripIds: string[],
): Promise<Map<string, string>> {
  if (!tripIds.length) return new Map()

  const rows = await db
    .select({
      tripId: containerEvents.tripId,
      chassisNumber: chassis.number,
    })
    .from(containerEvents)
    .innerJoin(chassis, eq(chassis.id, containerEvents.chassisId))
    .where(and(
      eq(containerEvents.companyId, companyId),
      inArray(containerEvents.tripId, tripIds),
      isNotNull(containerEvents.chassisId),
    ))
    .orderBy(desc(containerEvents.occurredAt))

  return latestChassisNumberByTrip(rows)
}

/** Full chassis row for a trip record that no longer points at `trips.chassis_id`. */
export async function chassisFromEvents(
  db: DbExecutor,
  companyId: string,
  tripId: string,
) {
  const [row] = await db
    .select({ chassis })
    .from(containerEvents)
    .innerJoin(chassis, eq(chassis.id, containerEvents.chassisId))
    .where(and(
      eq(containerEvents.companyId, companyId),
      eq(containerEvents.tripId, tripId),
      isNotNull(containerEvents.chassisId),
    ))
    .orderBy(desc(containerEvents.occurredAt))
    .limit(1)

  return row?.chassis ?? null
}
