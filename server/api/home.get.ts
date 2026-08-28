import { and, desc, eq, gte, inArray, isNotNull, ne, or, sql } from 'drizzle-orm'
import { chassis, containers, locations, trips } from '../database/schema'
import type { Trip } from '../database/schema'
import { findActiveTrips } from '../services/movements'
import { calendarDateInZone } from '#shared/utils/sms-task'
import { companyTimezone, listOpenTasksForHome } from '../services/tasks'
import { requireDriver } from '../utils/session'

type Db = ReturnType<typeof useDb>

async function bundleTrip(db: Db, trip: Trip) {
  const [container] = trip.containerId
    ? await db.select().from(containers).where(eq(containers.id, trip.containerId)).limit(1)
    : []

  const [origin] = trip.originLocationId
    ? await db.select({ id: locations.id, name: locations.name, type: locations.type }).from(locations).where(eq(locations.id, trip.originLocationId)).limit(1)
    : []

  const [destination] = trip.destinationLocationId
    ? await db.select({ id: locations.id, name: locations.name, type: locations.type }).from(locations).where(eq(locations.id, trip.destinationLocationId)).limit(1)
    : []

  const [chassisRow] = trip.chassisId
    ? await db.select({ id: chassis.id, number: chassis.number }).from(chassis).where(eq(chassis.id, trip.chassisId)).limit(1)
    : []

  return {
    trip,
    container: container ?? null,
    origin: origin ?? null,
    destination: destination ?? null,
    chassis: chassisRow ?? null,
  }
}

type BundledTrip = Awaited<ReturnType<typeof bundleTrip>>

function withPrimaryAction(bundle: BundledTrip, extraLive: BundledTrip | null) {
  const continuePickup = bundle.trip.status === 'PICKUP_IN_PROGRESS'
    ? bundle
    : extraLive?.trip.status === 'PICKUP_IN_PROGRESS'
      ? extraLive
      : null
  const arriveTrip = !bundle.trip.isLoaded && bundle.trip.status !== 'PICKUP_IN_PROGRESS'
    ? bundle
    : extraLive && !extraLive.trip.isLoaded && extraLive.trip.status !== 'PICKUP_IN_PROGRESS'
      ? extraLive
      : bundle

  return {
    ...bundle,
    primaryAction: continuePickup
      ? { label: 'Continue pickup', to: `/pickups/new?trip=${continuePickup.trip.id}` }
      : { label: 'Arrive', to: `/trips/${arriveTrip.trip.id}/dropoff` },
  }
}

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

  const [liveTrips, todayTasks] = await Promise.all([
    findActiveTrips(db, auth.companyId, auth.driverId),
    listOpenTasksForHome(db, auth, todayIso),
  ])

  const liveBundles = await Promise.all(liveTrips.map(trip => bundleTrip(db, trip)))
  const emptyLive = liveBundles.find(item => !item.trip.isLoaded && item.trip.kind !== 'BARE_CHASSIS')
  const primary = emptyLive ?? liveBundles[0] ?? null
  const partner = primary
    ? liveBundles.find(item => item.trip.id !== primary.trip.id) ?? null
    : null

  const active = primary ? withPrimaryAction(primary, partner) : null
  const swapPartner = partner
    ? {
        ...partner,
        primaryAction: partner.trip.status === 'PICKUP_IN_PROGRESS'
          ? { label: 'Continue pickup', to: `/pickups/new?trip=${partner.trip.id}` }
          : { label: 'Arrive', to: `/trips/${partner.trip.id}/dropoff` },
      }
    : null

  /** Last arrive from this driver, while Home still has no live trip. */
  let recentCompleted = null
  if (!primary) {
    const since = new Date(Date.now() - 12 * 60 * 60 * 1000)
    const [completedTrip] = await db
      .select()
      .from(trips)
      .where(and(
        eq(trips.companyId, auth.companyId),
        eq(trips.driverId, auth.driverId),
        inArray(trips.status, ['DROPPED_OFF', 'COMPLETED']),
        or(gte(trips.droppedOffAt, since), gte(trips.completedAt, since)),
      ))
      .orderBy(desc(trips.droppedOffAt), desc(trips.completedAt), desc(trips.updatedAt))
      .limit(1)

    if (completedTrip) recentCompleted = await bundleTrip(db, completedTrip)
  }

  const [swapCount] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(trips)
    .where(and(
      eq(trips.driverId, auth.driverId),
      isNotNull(trips.swapPairTripId),
      inArray(trips.status, ['COMPLETED', 'DROPPED_OFF']),
      eq(trips.isLoaded, false),
    ))

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
    stats: { bridgeCrosses: 0, swaps: swapCount?.value ?? 0 },
    todayIso,
    todayTasks,
    duty: {
      workDate: todayIso,
      isOnDuty: liveTrips.length > 0,
      reportedForDutyAt: null,
      releasedFromDutyAt: null,
      onDutyMinutes: 0,
      shortHaulStatus: 'UNKNOWN' as const,
    },
    active,
    swapPartner,
    recentCompleted,
    recentContainers,
    recentLocations,
    recentTrips,
    // TODO(Phase 2): replaced by the real Dexie outbox depth.
    pendingSync: { events: 0, photos: 0 },
  }
})
