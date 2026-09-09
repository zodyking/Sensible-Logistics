import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { aliasedTable } from 'drizzle-orm/pg-core'
import {
  chassis,
  containers,
  dispatchTasks,
  drivers,
  locations,
  trips,
  users,
} from '../database/schema'
import type { Database } from '../utils/db'
import type { AuthContext } from '../utils/session'
import { calendarDateInZone } from '#shared/utils/sms-task'
import type { ContainerType, TripKind, TripStatus } from '#shared/utils/domain'
import {
  cardFromTask,
  composeDispatchCardText,
  dispatchCardTitle,
  isDispatchCardComplete,
  normalizeDispatchCard,
  parsedFromDispatchCard,
  stepsForDispatchCard,
  type DispatchCard,
} from '#shared/utils/dispatch-cards'
import { stepsOrBlob } from '#shared/utils/task-steps'
import { companyTimezone, toView, type DispatchTaskView } from './tasks'
import { notifyDriverTaskChange } from './task-email'

export type DeskPlanStatus = 'empty' | 'draft' | 'submitted'
export type DeskMode = 'history' | 'edit'

export interface DeskDriver {
  id: string
  name: string
  email: string
  status: string
}

export interface DeskBox {
  id: string
  number: string
  containerType: string
  equipmentType: string
  isLoaded: boolean
  containerStatus: string
  locationId: string
}

export interface DeskLocation {
  id: string
  name: string
  type: string
  city: string | null
  state: string | null
  containers: DeskBox[]
}

export interface DeskTrip {
  id: string
  reference: string
  status: TripStatus
  isLoaded: boolean
  kind: TripKind | null
  createdAt: Date
  pickedUpAt: Date | null
  droppedOffAt: Date | null
  containerNumber: string | null
  containerType: ContainerType | null
  chassisNumber: string | null
  originName: string | null
  destinationName: string | null
}

export interface DeskPayload {
  todayIso: string
  timezone: string
  driver: DeskDriver | null
  drivers: DeskDriver[]
  workDate: string
  mode: DeskMode
  planStatus: DeskPlanStatus
  tasks: DispatchTaskView[]
  trips: DeskTrip[]
  locations: DeskLocation[]
}

async function listDeskDrivers(db: Database, companyId: string): Promise<DeskDriver[]> {
  const rows = await db
    .select({
      id: drivers.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      status: drivers.status,
    })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(and(eq(drivers.companyId, companyId), ne(drivers.status, 'INACTIVE')))
    .orderBy(users.lastName, users.firstName)
    .limit(200)

  return rows.map(row => ({
    id: row.id,
    name: `${row.firstName} ${row.lastName}`,
    email: row.email,
    status: row.status,
  }))
}

export async function loadDispatchLocations(db: Database, companyId: string): Promise<DeskLocation[]> {
  const siteRows = await db
    .select({
      id: locations.id,
      name: locations.name,
      type: locations.type,
      city: locations.city,
      state: locations.state,
    })
    .from(locations)
    .where(and(
      eq(locations.companyId, companyId),
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
          currentLocationId: containers.currentLocationId,
        })
        .from(containers)
        .where(and(
          eq(containers.companyId, companyId),
          inArray(containers.currentLocationId, locationIds),
          sql`${containers.activePoolState} <> 'INACTIVE'`,
        ))
    : []

  const byLocation = new Map<string, DeskBox[]>()
  for (const item of onSite) {
    const key = item.currentLocationId
    if (!key) continue
    const list = byLocation.get(key) ?? []
    list.push({
      id: item.id,
      number: item.number,
      containerType: item.containerType,
      equipmentType: item.equipmentType,
      isLoaded: item.isLoaded,
      containerStatus: item.containerStatus,
      locationId: key,
    })
    byLocation.set(key, list)
  }

  return siteRows.map(row => ({
    id: row.id,
    name: row.name,
    type: row.type,
    city: row.city,
    state: row.state,
    containers: byLocation.get(row.id) ?? [],
  }))
}

function tripOnDate(
  trip: { createdAt: Date, pickedUpAt: Date | null, droppedOffAt: Date | null },
  iso: string,
  timezone: string,
): boolean {
  const stamps = [trip.pickedUpAt, trip.droppedOffAt, trip.createdAt]
  return stamps.some(stamp => stamp && calendarDateInZone(stamp, timezone) === iso)
}

async function listDeskTrips(
  db: Database,
  companyId: string,
  driverId: string,
  workDate: string,
  timezone: string,
): Promise<DeskTrip[]> {
  const origin = aliasedTable(locations, 'origin_location')
  const destination = aliasedTable(locations, 'destination_location')
  const rows = await db
    .select({
      id: trips.id,
      reference: trips.reference,
      status: trips.status,
      isLoaded: trips.isLoaded,
      kind: trips.kind,
      createdAt: trips.createdAt,
      pickedUpAt: trips.pickedUpAt,
      droppedOffAt: trips.droppedOffAt,
      containerNumber: containers.number,
      containerType: containers.containerType,
      chassisNumber: chassis.number,
      originName: origin.name,
      destinationName: destination.name,
    })
    .from(trips)
    .leftJoin(containers, eq(containers.id, trips.containerId))
    .leftJoin(chassis, eq(chassis.id, trips.chassisId))
    .leftJoin(origin, eq(origin.id, trips.originLocationId))
    .leftJoin(destination, eq(destination.id, trips.destinationLocationId))
    .where(and(
      eq(trips.companyId, companyId),
      eq(trips.driverId, driverId),
      ne(trips.status, 'CANCELLED'),
    ))
    .orderBy(desc(trips.createdAt))
    .limit(200)

  return rows.filter(row => tripOnDate(row, workDate, timezone))
}

export async function loadDesk(
  db: Database,
  auth: AuthContext,
  query: { driverId?: string, date?: string },
): Promise<DeskPayload> {
  const timezone = await companyTimezone(db, auth.companyId)
  const todayIso = calendarDateInZone(new Date(), timezone)
  const driversList = await listDeskDrivers(db, auth.companyId)
  const driver = (query.driverId && driversList.find(item => item.id === query.driverId))
    || driversList[0]
    || null
  const workDate = /^\d{4}-\d{2}-\d{2}$/.test(query.date ?? '') ? query.date! : todayIso
  const mode: DeskMode = workDate < todayIso ? 'history' : 'edit'

  if (!driver) {
    return {
      todayIso,
      timezone,
      driver: null,
      drivers: [],
      workDate,
      mode,
      planStatus: 'empty',
      tasks: [],
      trips: [],
      locations: await loadDispatchLocations(db, auth.companyId),
    }
  }

  const rows = await db
    .select()
    .from(dispatchTasks)
    .where(and(
      eq(dispatchTasks.companyId, auth.companyId),
      eq(dispatchTasks.driverId, driver.id),
      eq(dispatchTasks.workDate, workDate),
      ne(dispatchTasks.status, 'DISMISSED'),
    ))
    .orderBy(asc(dispatchTasks.sortOrder), asc(dispatchTasks.receivedAt))

  const submitted = rows.filter(row => row.status !== 'DRAFT' && row.source !== 'MANUAL')
  const drafts = rows.filter(row => row.status === 'DRAFT')
  const manual = rows.filter(row => row.source === 'MANUAL' && row.status !== 'DRAFT')
  const dispatchRows = submitted.length ? submitted : drafts
  const planStatus: DeskPlanStatus = submitted.length
    ? 'submitted'
    : drafts.length
      ? 'draft'
      : 'empty'

  const visible = mode === 'history'
    ? [...dispatchRows, ...manual]
    : dispatchRows

  const [tripsForDay, locationsOut] = await Promise.all([
    listDeskTrips(db, auth.companyId, driver.id, workDate, timezone),
    loadDispatchLocations(db, auth.companyId),
  ])

  return {
    todayIso,
    timezone,
    driver,
    drivers: driversList,
    workDate,
    mode,
    planStatus,
    tasks: visible.map(row => toView(row, timezone, driver.name)),
    trips: tripsForDay,
    locations: locationsOut,
  }
}

function cardsEqual(a: DispatchCard, b: DispatchCard): boolean {
  return composeDispatchCardText(a) === composeDispatchCardText(b)
    && a.kind === b.kind
    && a.containerId === b.containerId
    && a.containerPending === b.containerPending
}

export async function saveDesk(
  db: Database,
  auth: AuthContext,
  input: {
    driverId: string
    workDate: string
    action: 'draft' | 'submit'
    cards: unknown[]
  },
): Promise<{ desk: DeskPayload, emailed: boolean }> {
  const timezone = await companyTimezone(db, auth.companyId)
  const todayIso = calendarDateInZone(new Date(), timezone)
  if (input.workDate < todayIso) {
    throw createError({ statusCode: 422, statusMessage: 'Past days are history — assign work on today or a future date.' })
  }

  const [driver] = await db
    .select({
      id: drivers.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(and(eq(drivers.id, input.driverId), eq(drivers.companyId, auth.companyId)))
    .limit(1)

  if (!driver) {
    throw createError({ statusCode: 404, statusMessage: 'Driver not found.' })
  }

  const cards = input.cards
    .map(item => normalizeDispatchCard(item))
    .filter((card): card is DispatchCard => Boolean(card))
    .filter(isDispatchCardComplete)

  if (input.action === 'submit' && !cards.length) {
    throw createError({ statusCode: 422, statusMessage: 'Add at least one task before sending it to the driver.' })
  }

  const existing = await db
    .select()
    .from(dispatchTasks)
    .where(and(
      eq(dispatchTasks.companyId, auth.companyId),
      eq(dispatchTasks.driverId, driver.id),
      eq(dispatchTasks.workDate, input.workDate),
      ne(dispatchTasks.source, 'MANUAL'),
    ))

  const submittedBefore = existing.some(row => row.status !== 'DRAFT' && row.status !== 'DISMISSED')
  const nextStatus = input.action === 'draft' && !submittedBefore ? 'DRAFT' : 'OPEN'
  const incomingIds = new Set(cards.map(card => card.id))
  const now = new Date()
  let changed = false

  await db.transaction(async (tx) => {
    for (const [index, card] of cards.entries()) {
      const current = existing.find(row => row.id === card.id)
      const steps = stepsForDispatchCard(card, current ? stepsOrBlob(current.parsed, current.rawText) : undefined)
      const rawText = composeDispatchCardText(card)
      const title = dispatchCardTitle(card)
      const parsed = parsedFromDispatchCard(card, { assignedByUserId: auth.userId, steps })
      const status = current && current.status !== 'DRAFT' && current.status !== 'DISMISSED' && nextStatus !== 'DRAFT'
        ? (current.status === 'DONE' || current.status === 'IN_PROGRESS' ? current.status : 'OPEN')
        : nextStatus

      if (!current) {
        changed = true
        await tx.insert(dispatchTasks).values({
          id: card.id,
          companyId: auth.companyId,
          driverId: driver.id,
          source: 'DISPATCH',
          rawText,
          sender: auth.fullName,
          receivedAt: now,
          workDate: input.workDate,
          kind: card.kind,
          title,
          parsed,
          status,
          sortOrder: index,
          fingerprint: `dispatch:${card.id}`,
        })
        continue
      }

      const priorCard = cardFromTask({
        id: current.id,
        kind: current.kind,
        rawText: current.rawText,
        parsed: current.parsed,
      })
      const same = cardsEqual(priorCard, card) && current.sortOrder === index && current.status === status
      if (!same) changed = true
      await tx
        .update(dispatchTasks)
        .set({
          rawText,
          sender: auth.fullName,
          kind: card.kind,
          title,
          parsed,
          status,
          sortOrder: index,
          updatedAt: now,
        })
        .where(eq(dispatchTasks.id, current.id))
    }

    for (const row of existing) {
      if (incomingIds.has(row.id)) continue
      if (row.status === 'DRAFT' || row.status === 'OPEN' || row.status === 'DISMISSED') {
        changed = true
        await tx.delete(dispatchTasks).where(eq(dispatchTasks.id, row.id))
      }
      else {
        changed = true
        await tx
          .update(dispatchTasks)
          .set({ status: 'DISMISSED', updatedAt: now })
          .where(eq(dispatchTasks.id, row.id))
      }
    }
  })

  const desk = await loadDesk(db, auth, { driverId: driver.id, date: input.workDate })
  const shouldEmail = input.action === 'submit' && desk.tasks.length > 0 && (changed || !submittedBefore)
  if (shouldEmail) {
    await notifyDriverTaskChange({
      email: driver.email,
      firstName: driver.firstName,
      workDate: input.workDate,
      dispatcherName: auth.fullName,
      kind: submittedBefore ? 'updated' : 'assigned',
      tasks: desk.tasks.filter(task => task.assigned && task.status !== 'DRAFT'),
    })
  }

  return { desk, emailed: shouldEmail }
}
