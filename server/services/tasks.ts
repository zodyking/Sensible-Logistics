import { randomBytes } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm'
import { companies, dispatchTasks, drivers, trips, users } from '../database/schema'
import type { DispatchTask } from '../database/schema'
import type { Database, DbExecutor } from '../utils/db'
import type { AuthContext } from '../utils/session'
import { calendarDateInZone, classifyDispatchKind } from '#shared/utils/sms-task'
import type { DispatchTaskKind, DispatchTaskSource, DispatchTaskStatus } from '#shared/utils/domain'
import {
  allStepsDone,
  firstLineTitle,
  normalizeSteps,
  someStepsDone,
  stepsFromBlob,
  stepsOrBlob,
} from '#shared/utils/task-steps'
import type { TaskStep } from '#shared/utils/task-steps'
import {
  applyAssignedStepPatch,
  cardFromTask,
  composeDispatchCardText,
  dispatchCardTitle,
  isAssignedTaskSource,
  parsedFromDispatchCard,
  stepsForDispatchCard,
  type DispatchCard,
} from '#shared/utils/dispatch-cards'
import { notifyDriverTaskChange } from './task-email'

export const DEFAULT_TASK_TIMEZONE = 'America/New_York'

export interface DispatchTaskView {
  id: string
  title: string
  rawText: string
  sender: string | null
  receivedAt: Date
  workDate: string
  kind: DispatchTaskKind
  status: DispatchTaskStatus
  source: DispatchTaskSource
  assigned: boolean
  editable: boolean
  tripId: string | null
  sortOrder: number
  steps: TaskStep[]
  card: DispatchCard
  parsed: Record<string, unknown>
  driverId: string
  driverName?: string | null
}

function toView(row: DispatchTask, timezone: string, driverName?: string | null): DispatchTaskView {
  const parsed = row.parsed ?? {}
  const addedDate = row.workDate
    || (row.receivedAt ? calendarDateInZone(row.receivedAt, timezone) : '')
  const source = (row.source ?? 'MANUAL') as DispatchTaskSource
  const assigned = isAssignedTaskSource(source)
  const card = cardFromTask({
    id: row.id,
    kind: row.kind,
    rawText: row.rawText,
    parsed,
  })
  return {
    id: row.id,
    title: assigned ? dispatchCardTitle(card) : row.title,
    rawText: row.rawText,
    sender: row.sender,
    receivedAt: row.receivedAt,
    workDate: addedDate,
    kind: row.kind,
    status: row.status,
    source,
    assigned,
    editable: source === 'MANUAL',
    tripId: row.tripId,
    sortOrder: row.sortOrder ?? 0,
    steps: stepsOrBlob(parsed, row.rawText),
    card,
    parsed,
    driverId: row.driverId,
    driverName: driverName ?? null,
  }
}

export { toView }

export async function companyTimezone(db: DbExecutor, companyId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
  return row?.timezone || DEFAULT_TASK_TIMEZONE
}

const VISIBLE_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE'] as const

export async function listDriverTasks(
  db: DbExecutor,
  auth: AuthContext & { driverId: string },
  options: { sinceIso?: string, limit?: number } = {},
): Promise<DispatchTaskView[]> {
  const limit = options.limit ?? 80
  const filters = [
    eq(dispatchTasks.companyId, auth.companyId),
    eq(dispatchTasks.driverId, auth.driverId),
    ne(dispatchTasks.status, 'DRAFT'),
    ne(dispatchTasks.status, 'DISMISSED'),
  ]
  if (options.sinceIso) {
    filters.push(gte(dispatchTasks.workDate, options.sinceIso))
  }

  const timezone = await companyTimezone(db, auth.companyId)
  const rows = await db
    .select()
    .from(dispatchTasks)
    .where(and(...filters))
    .orderBy(desc(dispatchTasks.workDate), asc(dispatchTasks.sortOrder), desc(dispatchTasks.receivedAt))
    .limit(limit)

  return rows.map(row => toView(row, timezone))
}

export async function listOpenTasksForHome(
  db: DbExecutor,
  auth: AuthContext & { driverId: string },
  todayIso: string,
): Promise<DispatchTaskView[]> {
  const timezone = await companyTimezone(db, auth.companyId)
  const rows = await db
    .select()
    .from(dispatchTasks)
    .where(and(
      eq(dispatchTasks.companyId, auth.companyId),
      eq(dispatchTasks.driverId, auth.driverId),
      gte(dispatchTasks.workDate, todayIso),
      inArray(dispatchTasks.status, ['OPEN', 'IN_PROGRESS']),
    ))
    .orderBy(asc(dispatchTasks.workDate), asc(dispatchTasks.sortOrder), desc(dispatchTasks.receivedAt))
    .limit(8)

  return rows.map(row => toView(row, timezone))
}

export async function listTasksForTrip(
  db: DbExecutor,
  auth: AuthContext,
  trip: { id: string, driverId: string | null, createdAt: Date, pickedUpAt: Date | null },
  timezone: string,
): Promise<DispatchTaskView[]> {
  if (!trip.driverId) return []
  if (auth.role !== 'ADMIN' && auth.driverId !== trip.driverId) return []

  const workDate = calendarDateInZone(trip.pickedUpAt ?? trip.createdAt, timezone)
  const rows = await db
    .select()
    .from(dispatchTasks)
    .where(and(
      eq(dispatchTasks.companyId, auth.companyId),
      eq(dispatchTasks.driverId, trip.driverId),
      ne(dispatchTasks.status, 'DRAFT'),
      or(
        eq(dispatchTasks.tripId, trip.id),
        and(
          eq(dispatchTasks.workDate, workDate),
          inArray(dispatchTasks.status, [...VISIBLE_STATUSES]),
        ),
      ),
    ))
    .orderBy(asc(dispatchTasks.sortOrder), desc(dispatchTasks.receivedAt))
    .limit(20)

  return rows.map(row => toView(row, timezone))
}

export async function attachOpenTasksToTrip(
  db: DbExecutor,
  input: {
    companyId: string
    driverId: string
    tripId: string
    workDate: string
    kinds?: DispatchTaskKind[]
  },
): Promise<void> {
  const kinds = input.kinds ?? (['PICKUP', 'DROPOFF', 'LOAD', 'EMPTY', 'WORK', 'NOTE'] as DispatchTaskKind[])
  await db
    .update(dispatchTasks)
    .set({
      tripId: input.tripId,
      updatedAt: new Date(),
    })
    .where(and(
      eq(dispatchTasks.companyId, input.companyId),
      eq(dispatchTasks.driverId, input.driverId),
      eq(dispatchTasks.workDate, input.workDate),
      isNull(dispatchTasks.tripId),
      inArray(dispatchTasks.kind, kinds),
      inArray(dispatchTasks.status, ['OPEN', 'IN_PROGRESS']),
    ))
}

export async function nextSortOrder(
  db: DbExecutor,
  driverId: string,
  workDate: string,
): Promise<number> {
  const [row] = await db
    .select({ sortOrder: dispatchTasks.sortOrder })
    .from(dispatchTasks)
    .where(and(eq(dispatchTasks.driverId, driverId), eq(dispatchTasks.workDate, workDate)))
    .orderBy(desc(dispatchTasks.sortOrder))
    .limit(1)
  return (row?.sortOrder ?? -1) + 1
}

export async function createManualTask(
  db: Database,
  auth: AuthContext & { driverId: string },
  text: string,
): Promise<DispatchTaskView> {
  const blob = text.trim()
  if (!blob) {
    throw createError({ statusCode: 422, statusMessage: 'Paste the work first.' })
  }

  const timezone = await companyTimezone(db, auth.companyId)
  const todayIso = calendarDateInZone(new Date(), timezone)
  const kind = classifyDispatchKind(blob)
  const title = firstLineTitle(blob)
  const steps = stepsFromBlob(blob)
  if (!steps.length) {
    throw createError({ statusCode: 422, statusMessage: 'Paste the work first.' })
  }

  const now = new Date()
  const sortOrder = await nextSortOrder(db, auth.driverId, todayIso)
  const [inserted] = await db
    .insert(dispatchTasks)
    .values({
      companyId: auth.companyId,
      driverId: auth.driverId,
      source: 'MANUAL',
      rawText: blob,
      sender: null,
      receivedAt: now,
      workDate: todayIso,
      kind,
      title,
      parsed: {
        origin: 'manual',
        containerNumbers: [],
        steps,
      },
      status: 'OPEN',
      sortOrder,
      fingerprint: `manual:${randomBytes(16).toString('hex')}`,
    })
    .returning()

  if (!inserted) {
    throw createError({ statusCode: 500, statusMessage: 'Could not save the task.' })
  }
  return toView(inserted, timezone)
}

export async function createAssignedTask(
  db: Database,
  auth: AuthContext,
  input: {
    driverId: string
    text?: string
    kind?: DispatchTaskKind
    containerNumber?: string | null
    containerId?: string | null
    containerPending?: boolean
    locationId?: string | null
    locationName?: string | null
    destinationLocationId?: string | null
    destinationLocationName?: string | null
    notes?: string | null
    workDate?: string
  },
): Promise<DispatchTaskView> {
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

  const timezone = await companyTimezone(db, auth.companyId)
  const todayIso = calendarDateInZone(new Date(), timezone)
  const workDate = input.workDate || todayIso
  const card: DispatchCard = {
    id: crypto.randomUUID(),
    kind: input.kind ?? 'NOTE',
    notes: input.notes?.trim() ?? '',
    locationId: input.locationId ?? null,
    locationName: input.locationName?.trim() ?? '',
    destinationLocationId: input.destinationLocationId ?? null,
    destinationLocationName: input.destinationLocationName?.trim() ?? '',
    containerId: input.containerId ?? null,
    containerNumber: (input.containerNumber ?? '').trim(),
    containerPending: input.containerPending === true,
  }
  const blob = (input.text ?? composeDispatchCardText(card)).trim()
  if (!blob) {
    throw createError({ statusCode: 422, statusMessage: 'Write the work first.' })
  }

  const steps = stepsForDispatchCard(card)
  const now = new Date()
  const sortOrder = await nextSortOrder(db, driver.id, workDate)
  const [inserted] = await db
    .insert(dispatchTasks)
    .values({
      id: card.id,
      companyId: auth.companyId,
      driverId: driver.id,
      source: 'DISPATCH',
      rawText: blob,
      sender: auth.fullName,
      receivedAt: now,
      workDate,
      kind: card.kind,
      title: dispatchCardTitle(card),
      parsed: parsedFromDispatchCard(card, { assignedByUserId: auth.userId, steps }),
      status: 'OPEN',
      sortOrder,
      fingerprint: `dispatch:${card.id}`,
    })
    .returning()

  if (!inserted) {
    throw createError({ statusCode: 500, statusMessage: 'Could not save the task.' })
  }
  const view = toView(inserted, timezone, `${driver.firstName} ${driver.lastName}`)
  await notifyDriverTaskChange({
    email: driver.email,
    firstName: driver.firstName,
    workDate,
    dispatcherName: auth.fullName,
    kind: 'assigned',
    tasks: [view],
  })
  return view
}

export async function listCompanyOpenTasks(
  db: DbExecutor,
  auth: AuthContext,
  options: { limit?: number } = {},
): Promise<DispatchTaskView[]> {
  const timezone = await companyTimezone(db, auth.companyId)
  const rows = await db
    .select({
      task: dispatchTasks,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(dispatchTasks)
    .innerJoin(drivers, eq(drivers.id, dispatchTasks.driverId))
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(and(
      eq(dispatchTasks.companyId, auth.companyId),
      inArray(dispatchTasks.status, ['OPEN', 'IN_PROGRESS']),
    ))
    .orderBy(desc(dispatchTasks.receivedAt))
    .limit(options.limit ?? 40)

  return rows.map(row => toView(row.task, timezone, `${row.firstName} ${row.lastName}`))
}

export async function updateDriverTask(
  db: Database,
  auth: AuthContext & { driverId: string },
  taskId: string,
  patch: { status?: DispatchTaskStatus, tripId?: string | null, steps?: TaskStep[] },
): Promise<DispatchTaskView> {
  const [row] = await db
    .select()
    .from(dispatchTasks)
    .where(and(
      eq(dispatchTasks.id, taskId),
      eq(dispatchTasks.companyId, auth.companyId),
      eq(dispatchTasks.driverId, auth.driverId),
    ))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  }

  if (row.status === 'DRAFT') {
    throw createError({ statusCode: 404, statusMessage: 'Task not found.' })
  }

  const assigned = isAssignedTaskSource(row.source)

  if (assigned && patch.status === 'DISMISSED') {
    throw createError({ statusCode: 403, statusMessage: 'Dispatch work cannot be removed.' })
  }

  if (patch.tripId) {
    const [trip] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(
        eq(trips.id, patch.tripId),
        eq(trips.companyId, auth.companyId),
        eq(trips.driverId, auth.driverId),
      ))
      .limit(1)
    if (!trip) {
      throw createError({ statusCode: 404, statusMessage: 'Trip not found.' })
    }
  }

  const nextParsed = { ...(row.parsed ?? {}) }
  let nextStatus = patch.status ?? row.status
  let nextTitle = row.title
  let nextRaw = row.rawText

  if (patch.steps) {
    const incoming = normalizeSteps(patch.steps)
    const steps = assigned
      ? applyAssignedStepPatch(stepsOrBlob(row.parsed, row.rawText), incoming)
      : incoming
    nextParsed.steps = steps
    if (!assigned) {
      nextRaw = steps.map(step => step.text).filter(Boolean).join('\n') || row.rawText
      const firstOpen = steps.find(step => !step.done)?.text
      nextTitle = firstOpen || steps[0]?.text || row.title
    }
    if (allStepsDone(steps)) nextStatus = 'DONE'
    else if (someStepsDone(steps)) nextStatus = 'IN_PROGRESS'
    else if (!patch.status) nextStatus = 'OPEN'
  }
  else if (patch.status === 'DONE') {
    const steps = stepsOrBlob(row.parsed, row.rawText).map(step => ({ ...step, done: true }))
    if (steps.length) nextParsed.steps = steps
  }

  const [updated] = await db
    .update(dispatchTasks)
    .set({
      status: nextStatus,
      tripId: patch.tripId === undefined ? row.tripId : patch.tripId,
      parsed: nextParsed,
      title: nextTitle,
      rawText: nextRaw,
      updatedAt: new Date(),
    })
    .where(eq(dispatchTasks.id, row.id))
    .returning()

  return toView(updated ?? row, await companyTimezone(db, auth.companyId))
}
