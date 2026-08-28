import { and, desc, eq, or } from 'drizzle-orm'
import {
  chassis,
  containerEvents,
  containers,
  locations,
  trips,
  users,
} from '../../database/schema'
import { assertTenant, requireAuth } from '../../utils/session'
import { sliceCurrentServiceLife, summarizeServiceLife } from '#shared/utils/service-life'

/** Chassis record: identity, current assignment, current service-life pickups/drop-offs. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Chassis id is required.' })
  }

  const db = useDb()

  const [record] = await db.select().from(chassis).where(eq(chassis.id, id)).limit(1)
  assertTenant(auth, record, 'Chassis')

  const [currentLocation] = record!.currentLocationId
    ? await db.select().from(locations).where(eq(locations.id, record!.currentLocationId)).limit(1)
    : []

  const [currentContainer] = record!.currentContainerId
    ? await db.select().from(containers).where(eq(containers.id, record!.currentContainerId)).limit(1)
    : []

  const events = await db
    .select({
      id: containerEvents.id,
      eventType: containerEvents.eventType,
      occurredAt: containerEvents.occurredAt,
      createdAt: containerEvents.createdAt,
      source: containerEvents.source,
      notes: containerEvents.notes,
      tripId: containerEvents.tripId,
      locationName: locations.name,
      locationType: locations.type,
      tripReference: trips.reference,
      actorFirstName: users.firstName,
      actorLastName: users.lastName,
      containerNumber: containers.number,
    })
    .from(containerEvents)
    .leftJoin(locations, eq(locations.id, containerEvents.locationId))
    .leftJoin(trips, eq(trips.id, containerEvents.tripId))
    .leftJoin(users, eq(users.id, containerEvents.actorUserId))
    .leftJoin(containers, eq(containers.id, containerEvents.containerId))
    .where(and(
      eq(containerEvents.companyId, auth.companyId),
      or(eq(containerEvents.chassisId, id), eq(trips.chassisId, id)),
    ))
    .orderBy(desc(containerEvents.occurredAt), desc(containerEvents.createdAt))
    .limit(400)

  const timeline = sliceCurrentServiceLife(events)

  return {
    chassis: record,
    currentLocation: currentLocation ?? null,
    currentContainer: currentContainer ?? null,
    serviceLife: summarizeServiceLife(timeline),
    timeline,
  }
})
