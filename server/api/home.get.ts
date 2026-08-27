import { aliasedTable, and, asc, desc, eq, gte, inArray, ne, or, sql } from 'drizzle-orm'
import {
  chassis,
  containerEvents,
  containers,
  documents,
  drivers,
  locations,
  trips,
} from '../database/schema'
import { findActiveTrip, findConnectedContainer } from '../services/movements'
import { getTodayView } from '../services/timecards'
import { requireDriver } from '../utils/session'
import type { DocumentCategory, LocationType } from '#shared/utils/domain'
import {
  connectedStatusLabel,
  deriveDriverPhase,
  documentChecklistForLocation,
  LOCATION_LANES,
  missingDocumentCategories,
} from '#shared/utils/workflow'
import type { DashboardAction } from '#shared/utils/workflow'

/**
 * Driver home: duty, workflow phase, hooked equipment, yard inventory, the
 * four location lanes, today's moves, and any open swap-document prompt.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireDriver(event)
  const db = useDb()

  const [duty, activeTrip, hooked, driverRow] = await Promise.all([
    getTodayView(db, auth.companyId, auth.driverId),
    findActiveTrip(db, auth.companyId, auth.driverId),
    findConnectedContainer(db, auth.companyId, auth.driverId),
    db.select({ homeTerminalLocationId: drivers.homeTerminalLocationId })
      .from(drivers)
      .where(eq(drivers.id, auth.driverId))
      .limit(1)
      .then(rows => rows[0] ?? null),
  ])

  const hookedAtLocation = Boolean(hooked?.currentLocationId)
    && (activeTrip?.status !== 'IN_TRANSIT')
  const phase = deriveDriverPhase({
    liveTripStatus: activeTrip?.status ?? null,
    hookedAtLocation,
  })

  const boardLocationId = hooked?.currentLocationId
    ?? activeTrip?.destinationLocationId
    ?? driverRow?.homeTerminalLocationId
    ?? null

  const locationIds = [
    boardLocationId,
    driverRow?.homeTerminalLocationId,
    activeTrip?.originLocationId,
    activeTrip?.destinationLocationId,
    hooked?.currentLocationId,
  ].filter((id): id is string => Boolean(id))

  const uniqueLocationIds = [...new Set(locationIds)]

  const locationRows = uniqueLocationIds.length
    ? await db
        .select({
          id: locations.id,
          name: locations.name,
          type: locations.type,
          city: locations.city,
          addressLine1: locations.addressLine1,
          capacity: locations.capacity,
        })
        .from(locations)
        .where(and(eq(locations.companyId, auth.companyId), inArray(locations.id, uniqueLocationIds)))
    : []

  const locationById = new Map(locationRows.map(row => [row.id, row]))
  const homeYard = driverRow?.homeTerminalLocationId
    ? locationById.get(driverRow.homeTerminalLocationId) ?? null
    : null
  const boardLocation = boardLocationId ? locationById.get(boardLocationId) ?? null : homeYard

  const [hookedChassis] = hooked?.currentChassisId
    ? await db.select({ id: chassis.id, number: chassis.number }).from(chassis).where(eq(chassis.id, hooked.currentChassisId)).limit(1)
    : []

  let active = null
  if (activeTrip) {
    const [container] = activeTrip.containerId
      ? await db.select().from(containers).where(eq(containers.id, activeTrip.containerId)).limit(1)
      : []

    const [tripChassis] = activeTrip.chassisId
      ? await db.select({ id: chassis.id, number: chassis.number }).from(chassis).where(eq(chassis.id, activeTrip.chassisId)).limit(1)
      : []

    active = {
      trip: activeTrip,
      container: container ?? null,
      origin: activeTrip.originLocationId ? locationById.get(activeTrip.originLocationId) ?? null : null,
      destination: activeTrip.destinationLocationId ? locationById.get(activeTrip.destinationLocationId) ?? null : null,
      chassis: tripChassis ?? null,
      primaryAction: activeTrip.status === 'PICKUP_IN_PROGRESS'
        ? { label: 'Continue pickup', kind: 'continue_pickup' as const, to: `/pickups/new?trip=${activeTrip.id}` }
        : activeTrip.status === 'IN_TRANSIT'
          ? { label: 'Arrive', kind: 'arrive' as const, to: `/trips/${activeTrip.id}` }
          : { label: 'Swap or drop off', kind: 'at_stop' as const, to: `/trips/${activeTrip.id}` },
    }
  }

  const connected = hooked
    ? {
        container: hooked,
        chassis: hookedChassis ?? null,
        location: hooked.currentLocationId ? locationById.get(hooked.currentLocationId) ?? null : null,
        statusLabel: connectedStatusLabel(auth.fullName),
        since: hooked.lastActivityAt,
      }
    : null

  const inventory = boardLocation
    ? await db
        .select({
          id: containers.id,
          number: containers.number,
          containerType: containers.containerType,
          equipmentType: containers.equipmentType,
          isLoaded: containers.isLoaded,
          activePoolState: containers.activePoolState,
          currentDriverId: containers.currentDriverId,
          sealNumber: containers.sealNumber,
        })
        .from(containers)
        .where(and(
          eq(containers.companyId, auth.companyId),
          eq(containers.currentLocationId, boardLocation.id),
          ne(containers.activePoolState, 'INACTIVE'),
        ))
        .orderBy(desc(containers.lastActivityAt))
        .limit(40)
    : []

  const available = inventory.filter(row =>
    row.currentDriverId == null || row.currentDriverId === auth.driverId,
  )
  const empties = available.filter(row => !row.isLoaded && row.id !== hooked?.id)
  const loads = available.filter(row => row.isLoaded && row.id !== hooked?.id)
  const counterpart = hooked
    ? (hooked.isLoaded ? empties : loads)
    : []

  const allLocations = await db
    .select({
      id: locations.id,
      name: locations.name,
      type: locations.type,
      city: locations.city,
      addressLine1: locations.addressLine1,
      occupancy: sql<number>`(
        select count(*)::int from ${containers} c
        where c.current_location_id = ${locations.id}
          and c.active_pool_state <> 'INACTIVE'
      )`,
    })
    .from(locations)
    .where(and(eq(locations.companyId, auth.companyId), eq(locations.status, 'ACTIVE')))
    .orderBy(asc(locations.name))

  const lanes = LOCATION_LANES.map((lane) => {
    const items = allLocations.filter(location =>
      (lane.types as readonly string[]).includes(location.type),
    )
    return {
      id: lane.id,
      title: lane.title,
      blurb: lane.blurb,
      count: items.reduce((sum, item) => sum + (item.occupancy ?? 0), 0),
      locations: items,
    }
  })

  const moveOrigin = aliasedTable(locations, 'move_origin')
  const moveDestination = aliasedTable(locations, 'move_destination')
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000)
  const todayMoves = await db
    .select({
      id: trips.id,
      reference: trips.reference,
      status: trips.status,
      isLoaded: trips.isLoaded,
      completedAt: trips.completedAt,
      createdAt: trips.createdAt,
      pickedUpAt: trips.pickedUpAt,
      containerNumber: containers.number,
      originName: moveOrigin.name,
      destinationName: moveDestination.name,
    })
    .from(trips)
    .leftJoin(containers, eq(containers.id, trips.containerId))
    .leftJoin(moveOrigin, eq(moveOrigin.id, trips.originLocationId))
    .leftJoin(moveDestination, eq(moveDestination.id, trips.destinationLocationId))
    .where(and(
      eq(trips.driverId, auth.driverId),
      or(gte(trips.createdAt, since), gte(trips.completedAt, since)),
    ))
    .orderBy(desc(trips.createdAt))
    .limit(8)

  const documentPrompt = await loadDocumentPrompt(db, auth.companyId, auth.driverId, hooked?.id ?? active?.container?.id ?? null)

  const nextActions = buildNextActions({
    phase,
    hookedLoaded: hooked?.isLoaded ?? active?.container?.isLoaded ?? null,
    counterpartCount: counterpart.length,
    emptyCount: empties.length,
    loadCount: loads.length,
    tripId: activeTrip?.id ?? null,
  })

  return {
    driver: { name: auth.fullName, firstName: auth.firstName, company: auth.companyName },
    duty: duty
      ? {
          workDate: duty.card.workDate,
          isOnDuty: duty.isOnDuty,
          reportedForDutyAt: duty.card.reportedForDutyAt,
          releasedFromDutyAt: duty.card.releasedFromDutyAt,
          onDutyMinutes: duty.onDutyMinutes,
          shortHaulStatus: duty.shortHaul.status,
        }
      : { workDate: null, isOnDuty: false, reportedForDutyAt: null, releasedFromDutyAt: null, onDutyMinutes: 0, shortHaulStatus: 'UNKNOWN' as const },
    phase,
    connected,
    active,
    homeYard,
    boardLocation,
    yardStats: {
      empties: empties.length,
      loads: loads.length,
      occupancy: inventory.length,
      capacity: boardLocation?.capacity ?? null,
    },
    inventory: {
      empties,
      loads,
      counterpart,
    },
    lanes,
    todayMoves,
    nextActions,
    documentPrompt,
    pendingSync: { events: 0, photos: 0 },
  }
})

async function loadDocumentPrompt(
  db: ReturnType<typeof useDb>,
  companyId: string,
  driverId: string,
  fallbackContainerId: string | null,
) {
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000)
  const [swap] = await db
    .select({
      id: containerEvents.id,
      containerId: containerEvents.containerId,
      tripId: containerEvents.tripId,
      locationId: containerEvents.locationId,
      payload: containerEvents.payload,
      occurredAt: containerEvents.occurredAt,
    })
    .from(containerEvents)
    .where(and(
      eq(containerEvents.companyId, companyId),
      eq(containerEvents.actorDriverId, driverId),
      eq(containerEvents.eventType, 'SWAPPED'),
      gte(containerEvents.occurredAt, since),
    ))
    .orderBy(desc(containerEvents.occurredAt))
    .limit(1)

  if (!swap || swap.payload?.counterpart) return null

  const containerId = typeof swap.payload?.pickedContainerId === 'string'
    ? swap.payload.pickedContainerId
    : swap.containerId

  const [location] = swap.locationId
    ? await db.select({ type: locations.type, name: locations.name }).from(locations).where(eq(locations.id, swap.locationId)).limit(1)
    : []

  const locationType = (location?.type ?? 'COMPANY_YARD') as LocationType
  const checklist = documentChecklistForLocation(locationType)

  const uploadedRows = await db
    .select({ category: documents.category })
    .from(documents)
    .where(and(
      eq(documents.companyId, companyId),
      eq(documents.containerId, containerId),
      sql`${documents.deletedAt} is null`,
      gte(documents.createdAt, since),
    ))

  const uploaded = uploadedRows.map(row => row.category as DocumentCategory)
  const missing = missingDocumentCategories(checklist, uploaded)
  if (!missing.length) return null

  return {
    title: 'Upload swap documents',
    locationType,
    locationName: location?.name ?? null,
    tripId: swap.tripId,
    containerId: containerId || fallbackContainerId,
    checklist,
    uploaded,
    missing,
  }
}

function buildNextActions(input: {
  phase: ReturnType<typeof deriveDriverPhase>
  hookedLoaded: boolean | null
  counterpartCount: number
  emptyCount: number
  loadCount: number
  tripId: string | null
}): DashboardAction[] {
  if (input.phase === 'pickup_in_progress' && input.tripId) {
    return [{ id: 'continue', label: 'Continue pickup', kind: 'continue_pickup', to: `/pickups/new?trip=${input.tripId}` }]
  }
  if (input.phase === 'in_transit' && input.tripId) {
    return [{ id: 'arrive', label: 'Arrive', kind: 'arrive' }]
  }
  if (input.phase === 'at_stop') {
    const actions = []
    if (input.counterpartCount) {
      actions.push({
        id: 'swap',
        label: input.hookedLoaded ? 'Swap — drop load, pick empty' : 'Swap — drop empty, pick load',
        kind: 'swap',
      })
    }
    actions.push({ id: 'dropoff', label: 'Drop off', kind: 'dropoff', to: input.tripId ? `/trips/${input.tripId}` : undefined })
    actions.push({ id: 'documents', label: 'Upload documents', kind: 'documents' })
    return actions
  }
  if (input.phase === 'connected') {
    const actions = [{ id: 'depart', label: 'Depart', kind: 'depart' }]
    if (input.counterpartCount) {
      actions.push({
        id: 'swap',
        label: input.hookedLoaded ? 'Swap — drop load, pick empty' : 'Swap — drop empty, pick load',
        kind: 'swap',
      })
    }
    actions.push({ id: 'documents', label: 'Documents', kind: 'documents' })
    return actions
  }
  const actions = []
  if (input.emptyCount) actions.push({ id: 'connect_empty', label: 'Connect to empty', kind: 'connect_empty' })
  if (input.loadCount) actions.push({ id: 'connect_load', label: 'Connect to load', kind: 'connect_load' })
  if (!actions.length) actions.push({ id: 'pickup', label: 'New pickup', kind: 'pickup', to: '/pickups/new' })
  return actions
}
