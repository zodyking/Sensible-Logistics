import { aliasedTable, and, desc, eq } from 'drizzle-orm'
import { chassis, containerEvents, containers, locations, trips, users } from '../../../database/schema'
import { companyTimezone, listTasksForTrip } from '../../../services/tasks'
import { assertTenant, requireAuth } from '../../../utils/session'
import { chassisFromEvents } from '../../../utils/trip-chassis'

const originLocation = aliasedTable(locations, 'origin_location')
const destinationLocation = aliasedTable(locations, 'destination_location')

/** Active movement detail: container, chassis, route and its event timeline. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Movement id is required.' })
  }

  const db = useDb()

  const [row] = await db
    .select({
      trip: trips,
      container: containers,
      chassis,
      origin: {
        id: originLocation.id,
        name: originLocation.name,
        city: originLocation.city,
        type: originLocation.type,
        mainPhone: originLocation.mainPhone,
        contactPhone: originLocation.contactPhone,
        contactName: originLocation.contactName,
      },
      destination: {
        id: destinationLocation.id,
        name: destinationLocation.name,
        city: destinationLocation.city,
        type: destinationLocation.type,
        mainPhone: destinationLocation.mainPhone,
        contactPhone: destinationLocation.contactPhone,
        contactName: destinationLocation.contactName,
      },
    })
    .from(trips)
    .leftJoin(containers, eq(containers.id, trips.containerId))
    .leftJoin(chassis, eq(chassis.id, trips.chassisId))
    .leftJoin(originLocation, eq(originLocation.id, trips.originLocationId))
    .leftJoin(destinationLocation, eq(destinationLocation.id, trips.destinationLocationId))
    .where(eq(trips.id, id))
    .limit(1)

  assertTenant(auth, row?.trip, 'Movement')

  let chassisRow = row!.chassis
  if (!chassisRow && row!.trip.kind === 'BARE_CHASSIS') {
    chassisRow = await chassisFromEvents(db, auth.companyId, id)
  }

  const timezone = await companyTimezone(db, auth.companyId)
  const [timeline, tasks] = await Promise.all([
    db
      .select({
        id: containerEvents.id,
        eventType: containerEvents.eventType,
        occurredAt: containerEvents.occurredAt,
        notes: containerEvents.notes,
        payload: containerEvents.payload,
        locationName: locations.name,
        chassisNumber: chassis.number,
        actorFirstName: users.firstName,
        actorLastName: users.lastName,
      })
      .from(containerEvents)
      .leftJoin(locations, eq(locations.id, containerEvents.locationId))
      .leftJoin(users, eq(users.id, containerEvents.actorUserId))
      .leftJoin(chassis, eq(chassis.id, containerEvents.chassisId))
      .where(and(eq(containerEvents.companyId, auth.companyId), eq(containerEvents.tripId, id)))
      .orderBy(desc(containerEvents.occurredAt))
      .limit(100),
    listTasksForTrip(db, auth, row!.trip, timezone),
  ])

  return { ...row!, chassis: chassisRow, timeline, tasks }
})
