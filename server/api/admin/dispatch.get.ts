import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { chassis, containerEvents, containers, drivers, locations, users } from '../../database/schema'
import { requireAdmin } from '../../utils/session'
import { listCompanyOpenTasks } from '../../services/tasks'
import { countContainersByType, emptyTypeCounts } from '#shared/utils/domain'
import { effectiveContainerStatus } from '#shared/utils/service-life'

/** Map board payload: locations, on-site pool, drivers, and open tasks. */
export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event)
  const db = useDb()

  const siteRows = await db
    .select({
      id: locations.id,
      name: locations.name,
      type: locations.type,
      addressLine1: locations.addressLine1,
      city: locations.city,
      state: locations.state,
      latitude: locations.latitude,
      longitude: locations.longitude,
      occupancy: sql<number>`(
        select count(*)::int from ${containers} c
        where c.current_location_id = ${locations.id}
          and c.company_id = ${locations.companyId}
          and c.active_pool_state <> 'INACTIVE'
      )`,
    })
    .from(locations)
    .where(and(
      eq(locations.companyId, auth.companyId),
      isNull(locations.deletedAt),
      eq(locations.isUncategorized, false),
    ))
    .orderBy(asc(locations.name))
    .limit(200)

  const locationIds = siteRows.map(row => row.id)
  const onSite = locationIds.length
    ? await db
        .select({
          id: containers.id,
          number: containers.number,
          containerType: containers.containerType,
          equipmentType: containers.equipmentType,
          isLoaded: containers.isLoaded,
          containerStatus: containers.containerStatus,
          activePoolState: containers.activePoolState,
          lastActivityAt: containers.lastActivityAt,
          currentLocationId: containers.currentLocationId,
          sealNumber: containers.sealNumber,
          chassisNumber: chassis.number,
        })
        .from(containers)
        .leftJoin(chassis, eq(chassis.id, containers.currentChassisId))
        .where(and(
          eq(containers.companyId, auth.companyId),
          inArray(containers.currentLocationId, locationIds),
          sql`${containers.activePoolState} <> 'INACTIVE'`,
        ))
    : []

  const containerIds = onSite.map(row => row.id)
  const dropEvents = containerIds.length
    ? await db
        .select({
          containerId: containerEvents.containerId,
          occurredAt: containerEvents.occurredAt,
        })
        .from(containerEvents)
        .where(and(
          eq(containerEvents.companyId, auth.companyId),
          eq(containerEvents.eventType, 'DROPOFF_CONFIRMED'),
          inArray(containerEvents.containerId, containerIds),
        ))
        .orderBy(desc(containerEvents.occurredAt))
    : []

  const droppedOffAt = new Map<string, Date>()
  for (const row of dropEvents) {
    if (!row.containerId || droppedOffAt.has(row.containerId)) continue
    droppedOffAt.set(row.containerId, row.occurredAt)
  }

  const byLocation = new Map<string, typeof onSite>()
  for (const item of onSite) {
    const key = item.currentLocationId
    if (!key) continue
    const list = byLocation.get(key) ?? []
    list.push(item)
    byLocation.set(key, list)
  }

  const locationsOut = siteRows.map((row) => {
    const boxes = (byLocation.get(row.id) ?? []).map(item => ({
      id: item.id,
      number: item.number,
      containerType: item.containerType,
      equipmentType: item.equipmentType,
      isLoaded: item.isLoaded,
      containerStatus: effectiveContainerStatus({
        containerStatus: item.containerStatus,
        activePoolState: item.activePoolState,
        locationType: row.type,
      }),
      activePoolState: item.activePoolState,
      sealNumber: item.sealNumber,
      chassisNumber: item.chassisNumber,
      droppedOffAt: droppedOffAt.get(item.id)?.toISOString() ?? item.lastActivityAt?.toISOString() ?? null,
    }))
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      addressLine1: row.addressLine1,
      city: row.city,
      state: row.state,
      latitude: row.latitude ? Number(row.latitude) : null,
      longitude: row.longitude ? Number(row.longitude) : null,
      occupancy: Number(row.occupancy) || boxes.length,
      typeCounts: boxes.length ? countContainersByType(boxes) : emptyTypeCounts(),
      containers: boxes,
    }
  })

  const driverRows = await db
    .select({
      id: drivers.id,
      firstName: users.firstName,
      lastName: users.lastName,
      status: drivers.status,
    })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(and(eq(drivers.companyId, auth.companyId), ne(drivers.status, 'INACTIVE')))
    .orderBy(users.lastName, users.firstName)
    .limit(100)

  const tasks = await listCompanyOpenTasks(db, auth)

  return {
    locations: locationsOut,
    drivers: driverRows.map(row => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`,
      status: row.status,
    })),
    tasks,
  }
})
