import { and, desc, eq, inArray, ne } from 'drizzle-orm'
import { chassis, containers, locations, trips } from '../database/schema'
import { findActiveTrip } from '../services/movements'
import { calendarDateInZone } from '#shared/utils/sms-task'
import { companyTimezone, listOpenTasksForHome } from '../services/tasks'
import { requireDriver } from '../utils/session'

/**
 * Everything the driver home screen needs in one round trip — the active
 * movement, open dispatch tasks, and the recent lists that let a driver
 * avoid typing.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const db = useDb()

  const timezone = await companyTimezone(db, auth.companyId)
  const todayIso = calendarDateInZone(new Date(), timezone)

  const [activeTrip, todayTasks] = await Promise.all([
    findActiveTrip(db, auth.companyId, auth.driverId),
    listOpenTasksForHome(db, auth, todayIso),
  ])

  let active = null
  if (activeTrip) {
    const [container] = activeTrip.containerId
      ? await db.select().from(containers).where(eq(containers.id, activeTrip.containerId)).limit(1)
      : []

    const [origin] = activeTrip.originLocationId
      ? await db.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.id, activeTrip.originLocationId)).limit(1)
      : []

    const [destination] = activeTrip.destinationLocationId
      ? await db.select({ id: locations.id, name: locations.name }).from(locations).where(eq(locations.id, activeTrip.destinationLocationId)).limit(1)
      : []

    const [chassisRow] = activeTrip.chassisId
      ? await db.select({ id: chassis.id, number: chassis.number }).from(chassis).where(eq(chassis.id, activeTrip.chassisId)).limit(1)
      : []

    active = {
      trip: activeTrip,
      container: container ?? null,
      origin: origin ?? null,
      destination: destination ?? null,
      chassis: chassisRow ?? null,
      /** Drives the single contextual primary action on the home card. */
      primaryAction: activeTrip.status === 'PICKUP_IN_PROGRESS'
        ? { label: 'Continue pickup', to: `/pickups/new?trip=${activeTrip.id}` }
        : { label: 'Arrive', to: `/trips/${activeTrip.id}/dropoff` },
    }
  }

  const recentContainers = await db
    .select({
      id: containers.id,
      number: containers.number,
      activePoolState: containers.activePoolState,
      isLoaded: containers.isLoaded,
      containerStatus: containers.containerStatus,
      lastActivityAt: containers.lastActivityAt,
      locationName: locations.name,
    })
    .from(containers)
    .leftJoin(locations, eq(locations.id, containers.currentLocationId))
    .where(and(eq(containers.companyId, auth.companyId), ne(containers.activePoolState, 'INACTIVE')))
    .orderBy(desc(containers.lastActivityAt))
    .limit(5)

  const recentLocations = await db
    .select({ id: locations.id, name: locations.name, type: locations.type, city: locations.city })
    .from(locations)
    .where(and(eq(locations.companyId, auth.companyId), eq(locations.status, 'ACTIVE')))
    .orderBy(desc(locations.updatedAt))
    .limit(5)

  const recentTrips = await db
    .select({
      id: trips.id,
      reference: trips.reference,
      status: trips.status,
      completedAt: trips.completedAt,
      createdAt: trips.createdAt,
      containerNumber: containers.number,
    })
    .from(trips)
    .leftJoin(containers, eq(containers.id, trips.containerId))
    .where(and(
      eq(trips.driverId, auth.driverId),
      inArray(trips.status, ['COMPLETED', 'DROPPED_OFF', 'CANCELLED', 'EXCEPTION']),
    ))
    .orderBy(desc(trips.createdAt))
    .limit(5)

  return {
    driver: { name: auth.fullName, firstName: auth.firstName, company: auth.companyName },
    /** Bridge crossings are a later increment. Swaps stay 0 until that flow is recorded. */
    stats: { bridgeCrosses: 0, swaps: 0 },
    todayIso,
    todayTasks,
    duty: {
      workDate: todayIso,
      isOnDuty: Boolean(activeTrip),
      reportedForDutyAt: null,
      releasedFromDutyAt: null,
      onDutyMinutes: 0,
      shortHaulStatus: 'UNKNOWN' as const,
    },
    active,
    recentContainers,
    recentLocations,
    recentTrips,
    // TODO(Phase 2): replaced by the real Dexie outbox depth.
    pendingSync: { events: 0, photos: 0 },
  }
})
