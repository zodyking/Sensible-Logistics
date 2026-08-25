import { and, desc, eq, isNull } from 'drizzle-orm'
import {
  chassis,
  containerEvents,
  containerPlacements,
  containers,
  documents,
  drivers,
  locations,
  trips,
  users,
} from '../../database/schema'
import { assertTenant, requireAuth } from '../../utils/session'

/** Container record: identity, current state, custody timeline and documents. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Container id is required.' })
  }

  const db = useDb()

  const [container] = await db.select().from(containers).where(eq(containers.id, id)).limit(1)
  assertTenant(auth, container, 'Container')

  const [currentLocation] = container!.currentLocationId
    ? await db.select().from(locations).where(eq(locations.id, container!.currentLocationId)).limit(1)
    : []

  const [currentChassis] = container!.currentChassisId
    ? await db.select().from(chassis).where(eq(chassis.id, container!.currentChassisId)).limit(1)
    : []

  const [currentDriver] = container!.currentDriverId
    ? await db
        .select({ id: drivers.id, firstName: users.firstName, lastName: users.lastName })
        .from(drivers)
        .innerJoin(users, eq(users.id, drivers.userId))
        .where(eq(drivers.id, container!.currentDriverId))
        .limit(1)
    : []

  const timeline = await db
    .select({
      id: containerEvents.id,
      eventType: containerEvents.eventType,
      occurredAt: containerEvents.occurredAt,
      createdAt: containerEvents.createdAt,
      source: containerEvents.source,
      notes: containerEvents.notes,
      payload: containerEvents.payload,
      yardPosition: containerEvents.yardPosition,
      locationName: locations.name,
      tripReference: trips.reference,
      actorFirstName: users.firstName,
      actorLastName: users.lastName,
      chassisNumber: chassis.number,
    })
    .from(containerEvents)
    .leftJoin(locations, eq(locations.id, containerEvents.locationId))
    .leftJoin(trips, eq(trips.id, containerEvents.tripId))
    .leftJoin(users, eq(users.id, containerEvents.actorUserId))
    .leftJoin(chassis, eq(chassis.id, containerEvents.chassisId))
    .where(and(eq(containerEvents.companyId, auth.companyId), eq(containerEvents.containerId, id)))
    .orderBy(desc(containerEvents.occurredAt), desc(containerEvents.createdAt))
    .limit(200)

  const [placement] = await db
    .select()
    .from(containerPlacements)
    .where(and(eq(containerPlacements.containerId, id), isNull(containerPlacements.supersededAt)))
    .limit(1)

  const files = await db
    .select({
      id: documents.id,
      category: documents.category,
      fileName: documents.fileName,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.companyId, auth.companyId), eq(documents.containerId, id), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt))

  return {
    container,
    currentLocation: currentLocation ?? null,
    currentChassis: currentChassis ?? null,
    currentDriver: currentDriver ? { id: currentDriver.id, name: `${currentDriver.firstName} ${currentDriver.lastName}` } : null,
    placement: placement ?? null,
    timeline,
    documents: files,
  }
})
