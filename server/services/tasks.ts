import { createHash, randomBytes } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { companies, dispatchTasks, smsInboundEndpoints, trips } from '../database/schema'
import type { DispatchTask } from '../database/schema'
import type { Database, DbExecutor } from '../utils/db'
import type { AuthContext } from '../utils/session'
import {
  calendarDateInZone,
  dispatchTaskTitle,
  isDispatchMessage,
  isSetupTestMessage,
  parseDispatchSms,
  SETUP_TEST_PHRASE,
  taskFingerprintSource,
} from '#shared/utils/sms-task'
import type { DispatchTaskKind, DispatchTaskStatus } from '#shared/utils/domain'
import {
  allStepsDone,
  firstLineTitle,
  normalizeSteps,
  someStepsDone,
  stepsFromBlob,
  stepsOrBlob,
} from '#shared/utils/task-steps'
import type { TaskStep } from '#shared/utils/task-steps'

export const DEFAULT_TASK_TIMEZONE = 'America/New_York'

export interface TaskSetupView {
  webhookUrl: string
  tokenTail: string
  testPhrase: string
  lastReceivedAt: Date | null
  lastTestAt: Date | null
  connected: boolean
  tested: boolean
}

export interface DispatchTaskView {
  id: string
  title: string
  rawText: string
  sender: string | null
  receivedAt: Date
  workDate: string
  kind: DispatchTaskKind
  status: DispatchTaskStatus
  source: 'SMS' | 'MANUAL'
  tripId: string | null
  steps: TaskStep[]
  parsed: Record<string, unknown>
}

function fingerprint(text: string, workDate: string): string {
  return createHash('sha256').update(taskFingerprintSource(text, workDate)).digest('hex')
}

function newToken(): string {
  return randomBytes(24).toString('base64url')
}

function toView(row: DispatchTask, timezone: string): DispatchTaskView {
  const parsed = row.parsed ?? {}
  const addedDate = row.receivedAt
    ? calendarDateInZone(row.receivedAt, timezone)
    : row.workDate
  return {
    id: row.id,
    title: isDispatchMessage(row.rawText)
      ? dispatchTaskTitle(row.rawText, row.kind, addedDate)
      : row.title,
    rawText: row.rawText,
    sender: row.sender,
    receivedAt: row.receivedAt,
    workDate: addedDate,
    kind: row.kind,
    status: row.status,
    source: row.source,
    tripId: row.tripId,
    steps: stepsOrBlob(parsed, row.rawText),
    parsed,
  }
}

function tokenTail(token: string): string {
  return token.slice(-6)
}

/** Public origin for webhook URLs. Configured app URL wins; otherwise the request origin. */
export function publicAppOrigin(event: H3Event): string {
  const configured = String(useRuntimeConfig().appUrl ?? '').trim().replace(/\/+$/, '')
  if (configured) return configured
  try {
    return getRequestURL(event).origin
  }
  catch {
    if (import.meta.dev) return 'http://localhost:3000'
    return ''
  }
}

export async function companyTimezone(db: DbExecutor, companyId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
  return row?.timezone || DEFAULT_TASK_TIMEZONE
}

export async function getOrCreateEndpoint(
  db: Database,
  auth: AuthContext & { driverId: string },
) {
  const [existing] = await db
    .select()
    .from(smsInboundEndpoints)
    .where(eq(smsInboundEndpoints.driverId, auth.driverId))
    .limit(1)

  if (existing) return existing

  const [created] = await db
    .insert(smsInboundEndpoints)
    .values({
      companyId: auth.companyId,
      driverId: auth.driverId,
      token: newToken(),
    })
    .onConflictDoNothing()
    .returning()

  if (created) return created

  const [raced] = await db
    .select()
    .from(smsInboundEndpoints)
    .where(eq(smsInboundEndpoints.driverId, auth.driverId))
    .limit(1)

  if (!raced) {
    throw createError({ statusCode: 500, statusMessage: 'Could not create the SMS webhook.' })
  }
  return raced
}

export function setupView(
  endpoint: typeof smsInboundEndpoints.$inferSelect,
  origin: string,
): TaskSetupView {
  const webhookUrl = origin
    ? `${origin}/api/tasks/inbound/${endpoint.token}`
    : `/api/tasks/inbound/${endpoint.token}`
  return {
    webhookUrl,
    tokenTail: tokenTail(endpoint.token),
    testPhrase: SETUP_TEST_PHRASE,
    lastReceivedAt: endpoint.lastReceivedAt,
    lastTestAt: endpoint.lastTestAt,
    connected: Boolean(endpoint.lastReceivedAt || endpoint.lastTestAt),
    tested: Boolean(endpoint.lastTestAt),
  }
}

export async function rotateEndpointToken(
  db: Database,
  auth: AuthContext & { driverId: string },
) {
  const existing = await getOrCreateEndpoint(db, auth)
  const [updated] = await db
    .update(smsInboundEndpoints)
    .set({
      token: newToken(),
      updatedAt: new Date(),
    })
    .where(eq(smsInboundEndpoints.id, existing.id))
    .returning()

  return updated ?? existing
}

export async function listDriverTasks(
  db: DbExecutor,
  auth: AuthContext & { driverId: string },
  options: { sinceIso?: string, limit?: number } = {},
): Promise<DispatchTaskView[]> {
  const limit = options.limit ?? 80
  const filters = [
    eq(dispatchTasks.companyId, auth.companyId),
    eq(dispatchTasks.driverId, auth.driverId),
  ]
  if (options.sinceIso) {
    filters.push(gte(dispatchTasks.workDate, options.sinceIso))
  }

  const timezone = await companyTimezone(db, auth.companyId)
  const rows = await db
    .select()
    .from(dispatchTasks)
    .where(and(...filters))
    .orderBy(desc(dispatchTasks.workDate), desc(dispatchTasks.receivedAt))
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
    .orderBy(asc(dispatchTasks.workDate), desc(dispatchTasks.receivedAt))
    .limit(5)

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
      or(
        eq(dispatchTasks.tripId, trip.id),
        and(
          eq(dispatchTasks.workDate, workDate),
          inArray(dispatchTasks.status, ['OPEN', 'IN_PROGRESS', 'DONE']),
        ),
      ),
    ))
    .orderBy(desc(dispatchTasks.receivedAt))
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
  const parsedSms = parseDispatchSms(blob, todayIso)
  /** Manual paste files on the calendar day it was added, not a date inside the blob. */
  const workDate = todayIso
  const kind = parsedSms?.kind ?? 'NOTE'
  const title = parsedSms?.title ?? firstLineTitle(blob)
  const steps = stepsFromBlob(blob)
  if (!steps.length) {
    throw createError({ statusCode: 422, statusMessage: 'Paste the work first.' })
  }

  const now = new Date()
  const [inserted] = await db
    .insert(dispatchTasks)
    .values({
      companyId: auth.companyId,
      driverId: auth.driverId,
      source: 'MANUAL',
      rawText: blob,
      sender: null,
      receivedAt: now,
      workDate,
      kind,
      title,
      parsed: {
        origin: 'manual',
        containerNumbers: parsedSms?.containerNumbers ?? [],
        steps,
      },
      status: 'OPEN',
      fingerprint: `manual:${randomBytes(16).toString('hex')}`,
    })
    .returning()

  if (!inserted) {
    throw createError({ statusCode: 500, statusMessage: 'Could not save the task.' })
  }
  return toView(inserted, timezone)
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
    const steps = normalizeSteps(patch.steps)
    nextParsed.steps = steps
    nextRaw = steps.map(step => step.text).filter(Boolean).join('\n') || row.rawText
    const firstOpen = steps.find(step => !step.done)?.text
    nextTitle = firstOpen || steps[0]?.text || row.title
    if (allStepsDone(steps)) nextStatus = 'DONE'
    else if (someStepsDone(steps)) nextStatus = 'IN_PROGRESS'
    else if (!patch.status) nextStatus = 'OPEN'
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

export type InboundResult
  = { ok: true, kind: 'test' }
    | { ok: true, kind: 'ignored' }
    | { ok: true, kind: 'duplicate', taskId: string }
    | { ok: true, kind: 'task', taskId: string }

export async function ingestInboundSms(
  db: Database,
  token: string,
  payload: { text: string, sender: string | null },
): Promise<InboundResult> {
  const text = payload.text.trim()
  if (!text) {
    throw createError({ statusCode: 400, statusMessage: 'Message text is required.' })
  }

  const [endpoint] = await db
    .select()
    .from(smsInboundEndpoints)
    .where(eq(smsInboundEndpoints.token, token))
    .limit(1)

  if (!endpoint) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown webhook.' })
  }

  const now = new Date()
  const timezone = await companyTimezone(db, endpoint.companyId)
  const todayIso = calendarDateInZone(now, timezone)

  await db
    .update(smsInboundEndpoints)
    .set({
      lastReceivedAt: now,
      lastTestAt: isSetupTestMessage(text) ? now : endpoint.lastTestAt,
      updatedAt: now,
    })
    .where(eq(smsInboundEndpoints.id, endpoint.id))

  if (isSetupTestMessage(text)) {
    return { ok: true, kind: 'test' }
  }

  if (!isDispatchMessage(text)) {
    return { ok: true, kind: 'ignored' }
  }

  const parsed = parseDispatchSms(text, todayIso)
  if (!parsed) {
    return { ok: true, kind: 'ignored' }
  }

  const print = fingerprint(text, parsed.workDate)

  const [inserted] = await db
    .insert(dispatchTasks)
    .values({
      companyId: endpoint.companyId,
      driverId: endpoint.driverId,
      source: 'SMS',
      rawText: text,
      sender: payload.sender,
      receivedAt: now,
      workDate: parsed.workDate,
      kind: parsed.kind,
      title: parsed.title,
      parsed: {
        containerNumbers: parsed.containerNumbers,
        steps: stepsFromBlob(text),
      },
      status: 'OPEN',
      fingerprint: print,
    })
    .onConflictDoNothing()
    .returning({ id: dispatchTasks.id })

  if (inserted) {
    return { ok: true, kind: 'task', taskId: inserted.id }
  }

  const [existing] = await db
    .select({ id: dispatchTasks.id })
    .from(dispatchTasks)
    .where(and(
      eq(dispatchTasks.driverId, endpoint.driverId),
      eq(dispatchTasks.fingerprint, print),
    ))
    .limit(1)

  return { ok: true, kind: 'duplicate', taskId: existing?.id ?? '' }
}
