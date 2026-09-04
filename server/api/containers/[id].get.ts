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
import { latestSnapshotsForContainers } from '../../services/csx-releases'
import { sliceCurrentServiceLife, summarizeServiceLife } from '#shared/utils/service-life'
import { normalizeContainerNumber } from '#shared/utils/iso6346'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Container record: identity, current state, current service-life pickups/drop-offs. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Container id is required.' })
  }

  const db = useDb()

  const [container] = UUID_RE.test(id)
    ? await db.select().from(containers).where(eq(containers.id, id)).limit(1)
    : await db
        .select()
        .from(containers)
        .where(and(
          eq(containers.companyId, auth.companyId),
          eq(containers.numberNormalized, normalizeContainerNumber(id)),
        ))
        .limit(1)
  assertTenant(auth, container, 'Container')
  if (container!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Container not found.' })
  }
  const containerId = container!.id

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

  const events = await db
    .select({
      id: containerEvents.id,
      eventType: containerEvents.eventType,
      occurredAt: containerEvents.occurredAt,
      createdAt: containerEvents.createdAt,
      source: containerEvents.source,
      notes: containerEvents.notes,
      payload: containerEvents.payload,
      yardPosition: containerEvents.yardPosition,
      tripId: containerEvents.tripId,
      locationName: locations.name,
      locationType: locations.type,
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
    .where(and(eq(containerEvents.companyId, auth.companyId), eq(containerEvents.containerId, containerId)))
    .orderBy(desc(containerEvents.occurredAt), desc(containerEvents.createdAt))
    .limit(400)

  const timeline = sliceCurrentServiceLife(events)
  const serviceLife = summarizeServiceLife(timeline)

  const [placement] = await db
    .select()
    .from(containerPlacements)
    .where(and(eq(containerPlacements.containerId, containerId), isNull(containerPlacements.supersededAt)))
    .limit(1)

  const files = await db
    .select({
      id: documents.id,
      category: documents.category,
      fileName: documents.fileName,
      createdAt: documents.createdAt,
    })
    .from(documents)
    .where(and(eq(documents.companyId, auth.companyId), eq(documents.containerId, containerId), isNull(documents.deletedAt)))
    .orderBy(desc(documents.createdAt))

  const [shipcsx] = await latestSnapshotsForContainers(db, auth.companyId, [containerId])

  return {
    container,
    currentLocation: currentLocation ?? null,
    currentChassis: currentChassis ?? null,
    currentDriver: currentDriver ? { id: currentDriver.id, name: `${currentDriver.firstName} ${currentDriver.lastName}` } : null,
    placement: placement ?? null,
    serviceLife,
    timeline,
    documents: files,
    shipcsx: shipcsx ?? null,
  }
})
