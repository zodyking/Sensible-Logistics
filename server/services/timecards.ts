import { createHash } from 'node:crypto'
import { and, asc, desc, eq, gte, lt, lte } from 'drizzle-orm'
import type { Database, DbExecutor } from '../utils/db'
import {
  companies,
  driverTimecards,
  drivers,
  locations,
  timecardBreaks,
  timecardComplianceChecks,
  timecardCorrections,
  users,
} from '../database/schema'
import type { DriverTimecard } from '../database/schema'
import type { AuthContext } from '../utils/session'
import {
  CYCLE_LIMITS,
  REQUIRED_OFF_DUTY_MINUTES,
  SHORT_HAUL_WINDOW_MINUTES,
} from '#shared/utils/domain'
import type { CycleType, ShortHaulStatus } from '#shared/utils/domain'

/**
 * FMCSA 150 air-mile short-haul time records — 49 CFR §395.1(e)(1).
 *
 * Design constraints from spec 14:
 *  - Clock In is the authoritative report-for-duty time; it is never inferred
 *    from the first container movement.
 *  - Stored punches are never silently overwritten; changes are corrections.
 *  - Records are retained for at least 6 months and are not ordinarily deletable.
 *  - This is a time record, not an ELD and not a RODS graph-grid log.
 */

/** Records must be retained for no less than the federal 6-month minimum. */
export const RETENTION_DAYS = 186

/** Calendar day in a given IANA timezone, as `YYYY-MM-DD`. */
export function localWorkDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export interface TimecardBreakRow {
  startedAt: Date
  endedAt: Date | null
  countedAsOffDuty: boolean
}

/**
 * On-duty minutes for a day. Only true off-duty intervals are deducted; the app
 * deliberately does not impose a 30-minute break rule on §395.1(e)(1) drivers.
 *
 * @param now used as the end of an open tour, producing CURRENT ELAPSED ON-DUTY
 */
export function onDutyMinutes(card: Pick<DriverTimecard, 'reportedForDutyAt' | 'releasedFromDutyAt'>, breaks: TimecardBreakRow[], now = new Date()): number {
  if (!card.reportedForDutyAt) return 0
  const end = card.releasedFromDutyAt ?? now
  const gross = Math.max(0, Math.round((end.getTime() - card.reportedForDutyAt.getTime()) / 60000))

  const offDuty = breaks
    .filter(b => b.countedAsOffDuty && b.endedAt)
    .reduce((total, b) => total + Math.max(0, Math.round((b.endedAt!.getTime() - b.startedAt.getTime()) / 60000)), 0)

  return Math.max(0, gross - offDuty)
}

/** Format minutes as `7.8 h`, matching the design template's ledger column. */
export function formatHours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)} h`
}

/**
 * Resolve the driver's timecard for a work date, creating an OPEN shell if the
 * day has not been started yet.
 */
export async function getOrCreateTimecard(
  tx: DbExecutor,
  companyId: string,
  driverId: string,
  workDate: string,
  cycleType: CycleType,
  reportingLocationId: string | null,
): Promise<DriverTimecard> {
  const [existing] = await tx
    .select()
    .from(driverTimecards)
    .where(and(eq(driverTimecards.driverId, driverId), eq(driverTimecards.workDate, workDate)))
    .limit(1)

  if (existing) return existing

  const [created] = await tx
    .insert(driverTimecards)
    .values({
      companyId,
      driverId,
      workDate,
      cycleType,
      reportingLocationId,
      status: 'OPEN',
      shortHaulStatus: 'UNKNOWN',
      retainUntil: addDays(workDate, RETENTION_DAYS),
    })
    .onConflictDoNothing({ target: [driverTimecards.driverId, driverTimecards.workDate] })
    .returning()

  if (created) return created

  const [raced] = await tx
    .select()
    .from(driverTimecards)
    .where(and(eq(driverTimecards.driverId, driverId), eq(driverTimecards.workDate, workDate)))
    .limit(1)

  return raced!
}

/** Total on-duty minutes across the 7 days preceding a work date — §395.8(j)(2). */
export async function preceding7DayMinutes(db: DbExecutor, driverId: string, workDate: string): Promise<number> {
  const start = addDays(workDate, -7)
  const rows = await db
    .select({ minutes: driverTimecards.totalOnDutyMinutes })
    .from(driverTimecards)
    .where(and(
      eq(driverTimecards.driverId, driverId),
      gte(driverTimecards.workDate, start),
      lt(driverTimecards.workDate, workDate),
    ))

  return rows.reduce((total, row) => total + row.minutes, 0)
}

/** Rolling on-duty minutes across the configured 60/7 or 70/8 cycle window. */
export async function rollingCycleMinutes(db: DbExecutor, driverId: string, workDate: string, cycleType: CycleType): Promise<number> {
  const { days } = CYCLE_LIMITS[cycleType]
  const start = addDays(workDate, -(days - 1))
  const rows = await db
    .select({ minutes: driverTimecards.totalOnDutyMinutes })
    .from(driverTimecards)
    .where(and(
      eq(driverTimecards.driverId, driverId),
      gte(driverTimecards.workDate, start),
      lte(driverTimecards.workDate, workDate),
    ))

  return rows.reduce((total, row) => total + row.minutes, 0)
}

/**
 * Evaluate the §395.1(e)(1) conditions that recorded data can actually support.
 *
 * The radius and return-location checks are intentionally reported as
 * `RECORDED_LOCATIONS_ONLY` evidence: the route between stops is unknown, so a
 * full-compliance badge would be false (spec 14.3).
 */
export function evaluateShortHaul(input: {
  reportedForDutyAt: Date | null
  releasedFromDutyAt: Date | null
  now?: Date
}): { status: ShortHaulStatus, releasedWithin14Hours: boolean | null, elapsedMinutes: number } {
  const now = input.now ?? new Date()
  if (!input.reportedForDutyAt) {
    return { status: 'UNKNOWN', releasedWithin14Hours: null, elapsedMinutes: 0 }
  }

  const end = input.releasedFromDutyAt ?? now
  const elapsedMinutes = Math.max(0, Math.round((end.getTime() - input.reportedForDutyAt.getTime()) / 60000))
  const withinWindow = elapsedMinutes <= SHORT_HAUL_WINDOW_MINUTES

  if (!withinWindow) {
    return { status: 'NOT_AVAILABLE', releasedWithin14Hours: false, elapsedMinutes }
  }

  if (input.releasedFromDutyAt) {
    return { status: 'QUALIFIED', releasedWithin14Hours: true, elapsedMinutes }
  }

  // Open tour: warn once the 14-hour window is within an hour of closing.
  const status: ShortHaulStatus = elapsedMinutes >= SHORT_HAUL_WINDOW_MINUTES - 60 ? 'AT_RISK' : 'UNKNOWN'
  return { status, releasedWithin14Hours: null, elapsedMinutes }
}

/** Company timezone + cycle, used to derive the driver's local work date. */
async function loadCompanyContext(db: DbExecutor, companyId: string) {
  const [company] = await db
    .select({ timezone: companies.timezone, cycleType: companies.cycleType })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)

  return { timezone: company?.timezone ?? 'America/New_York', cycleType: (company?.cycleType ?? 'SEVENTY_EIGHT') as CycleType }
}

/** Clock In — the authoritative time the driver reported for duty. */
export async function clockIn(db: Database, auth: AuthContext & { driverId: string }, at = new Date()) {
  const { timezone, cycleType } = await loadCompanyContext(db, auth.companyId)
  const workDate = localWorkDate(at, timezone)

  return db.transaction(async (tx) => {
    const [driver] = await tx.select().from(drivers).where(eq(drivers.id, auth.driverId)).limit(1)
    const card = await getOrCreateTimecard(tx, auth.companyId, auth.driverId, workDate, cycleType, driver?.homeTerminalLocationId ?? null)

    if (card.reportedForDutyAt && !card.releasedFromDutyAt) {
      throw createError({ statusCode: 409, statusMessage: 'You are already on duty.' })
    }
    if (card.status === 'LOCKED') {
      throw createError({ statusCode: 409, statusMessage: 'This day is locked. Submit a correction request instead.' })
    }

    // Re-opening a completed day is a correction, never a silent overwrite.
    if (card.releasedFromDutyAt) {
      await tx.insert(timecardCorrections).values({
        companyId: auth.companyId,
        timecardId: card.id,
        fieldName: 'released_from_duty_at',
        originalValue: card.releasedFromDutyAt.toISOString(),
        correctedValue: null,
        changedByUserId: auth.userId,
        reason: 'Driver returned to duty on the same work date.',
      })
    }

    const [updated] = await tx
      .update(driverTimecards)
      .set({
        reportedForDutyAt: card.reportedForDutyAt ?? at,
        releasedFromDutyAt: null,
        status: 'OPEN',
        shortHaulStatus: 'UNKNOWN',
        completedAt: null,
      })
      .where(eq(driverTimecards.id, card.id))
      .returning()

    await tx.update(drivers).set({ status: 'AVAILABLE', updatedAt: at }).where(eq(drivers.id, auth.driverId))

    return updated!
  })
}

/** Clock Out — the authoritative time the driver was released from duty. */
export async function clockOut(db: Database, auth: AuthContext & { driverId: string }, at = new Date()) {
  const { timezone, cycleType } = await loadCompanyContext(db, auth.companyId)
  const workDate = localWorkDate(at, timezone)

  return db.transaction(async (tx) => {
    const [card] = await tx
      .select()
      .from(driverTimecards)
      .where(and(eq(driverTimecards.driverId, auth.driverId), eq(driverTimecards.workDate, workDate)))
      .limit(1)

    if (!card?.reportedForDutyAt) {
      throw createError({ statusCode: 409, statusMessage: 'You are not currently on duty.' })
    }
    if (card.releasedFromDutyAt) {
      throw createError({ statusCode: 409, statusMessage: 'You have already clocked out for this day.' })
    }

    const breaks = await tx
      .select({
        startedAt: timecardBreaks.startedAt,
        endedAt: timecardBreaks.endedAt,
        countedAsOffDuty: timecardBreaks.countedAsOffDuty,
      })
      .from(timecardBreaks)
      .where(eq(timecardBreaks.timecardId, card.id))

    const total = onDutyMinutes({ reportedForDutyAt: card.reportedForDutyAt, releasedFromDutyAt: at }, breaks, at)
    const evaluation = evaluateShortHaul({ reportedForDutyAt: card.reportedForDutyAt, releasedFromDutyAt: at })
    const preceding = await preceding7DayMinutes(tx, auth.driverId, workDate)

    const [updated] = await tx
      .update(driverTimecards)
      .set({
        releasedFromDutyAt: at,
        totalOnDutyMinutes: total,
        preceding7DayMinutes: preceding,
        status: 'COMPLETED',
        shortHaulStatus: evaluation.status,
        completedAt: at,
        cycleType,
      })
      .where(eq(driverTimecards.id, card.id))
      .returning()

    const priorOffDuty = await priorOffDutyMinutes(tx, auth.driverId, workDate, card.reportedForDutyAt)
    const cycleMinutes = await rollingCycleMinutes(tx, auth.driverId, workDate, cycleType)

    await tx
      .insert(timecardComplianceChecks)
      .values({
        companyId: auth.companyId,
        timecardId: card.id,
        priorOffDutyMinutes: priorOffDuty,
        // TODO(Phase 2): derive from the great-circle distance between the
        // reporting location and every recorded stop on the day's trips.
        maxRecordedAirMiles: null,
        returnedToReportingLocation: null,
        releasedWithin14Hours: evaluation.releasedWithin14Hours,
        rollingCycleMinutes: cycleMinutes,
        radiusEvidenceLevel: 'RECORDED_LOCATIONS_ONLY',
        evaluatedAt: at,
      })
      .onConflictDoUpdate({
        target: timecardComplianceChecks.timecardId,
        set: {
          priorOffDutyMinutes: priorOffDuty,
          releasedWithin14Hours: evaluation.releasedWithin14Hours,
          rollingCycleMinutes: cycleMinutes,
          evaluatedAt: at,
        },
      })

    await tx.update(drivers).set({ status: 'OFF_DUTY', updatedAt: at }).where(eq(drivers.id, auth.driverId))

    return updated!
  })
}

/** Minutes between the previous release from duty and this report-for-duty. */
async function priorOffDutyMinutes(db: DbExecutor, driverId: string, workDate: string, reportedAt: Date): Promise<number | null> {
  const [previous] = await db
    .select({ releasedAt: driverTimecards.releasedFromDutyAt })
    .from(driverTimecards)
    .where(and(eq(driverTimecards.driverId, driverId), lt(driverTimecards.workDate, workDate)))
    .orderBy(desc(driverTimecards.workDate))
    .limit(1)

  if (!previous?.releasedAt) return null
  return Math.max(0, Math.round((reportedAt.getTime() - previous.releasedAt.getTime()) / 60000))
}

export interface TimecardView {
  card: DriverTimecard
  /** Live value for an open day; the stored total once completed. */
  onDutyMinutes: number
  isOnDuty: boolean
  shortHaul: ReturnType<typeof evaluateShortHaul>
  breaks: TimecardBreakRow[]
}

/** Today's card plus the live elapsed value used by the driver home screen. */
export async function getTodayView(db: Database, companyId: string, driverId: string, now = new Date()): Promise<TimecardView | null> {
  const { timezone } = await loadCompanyContext(db, companyId)
  const workDate = localWorkDate(now, timezone)

  const [card] = await db
    .select()
    .from(driverTimecards)
    .where(and(eq(driverTimecards.driverId, driverId), eq(driverTimecards.workDate, workDate)))
    .limit(1)

  if (!card) return null

  const breaks = await db
    .select({
      startedAt: timecardBreaks.startedAt,
      endedAt: timecardBreaks.endedAt,
      countedAsOffDuty: timecardBreaks.countedAsOffDuty,
    })
    .from(timecardBreaks)
    .where(eq(timecardBreaks.timecardId, card.id))

  return {
    card,
    onDutyMinutes: onDutyMinutes(card, breaks, now),
    isOnDuty: Boolean(card.reportedForDutyAt && !card.releasedFromDutyAt),
    shortHaul: evaluateShortHaul({
      reportedForDutyAt: card.reportedForDutyAt,
      releasedFromDutyAt: card.releasedFromDutyAt,
      now,
    }),
    breaks,
  }
}

/** Recent history for the timecard screen, newest first. */
export async function listTimecards(db: Database, driverId: string, limit = 30) {
  return db
    .select()
    .from(driverTimecards)
    .where(eq(driverTimecards.driverId, driverId))
    .orderBy(desc(driverTimecards.workDate))
    .limit(limit)
}

/* ============================================================
   Roadside / printable record
   ============================================================ */

export interface RoadsideRecord {
  recordId: string
  generatedAt: string
  verificationHash: string
  carrierLegalName: string
  usdotNumber: string | null
  driverFullName: string
  workDate: string
  reportingLocationName: string
  timezoneAbbreviation: string
  reportedForDuty: string
  releasedFromDuty: string
  totalOnDutyLabel: string
  totalOnDutyValue: string
  preceding7DayTotal: string
  cycleSummary: string
  isOpen: boolean
  shortHaulStatus: ShortHaulStatus
  supportingChecks: Array<{ label: string, value: string, evidence: string }>
}

/**
 * Build the §395.1(e)(1) time record from authoritative server-side data.
 *
 * Never derived from client display state (spec 14.4). The verification hash
 * lets a printed or screenshotted copy be matched back to the stored record.
 */
export async function buildRoadsideRecord(
  db: Database,
  auth: AuthContext,
  driverId: string,
  workDate: string,
  now = new Date(),
): Promise<RoadsideRecord> {
  const [card] = await db
    .select()
    .from(driverTimecards)
    .where(and(
      eq(driverTimecards.driverId, driverId),
      eq(driverTimecards.workDate, workDate),
      eq(driverTimecards.companyId, auth.companyId),
    ))
    .limit(1)

  if (!card) {
    throw createError({ statusCode: 404, statusMessage: 'No time record exists for that date.' })
  }

  const [company] = await db.select().from(companies).where(eq(companies.id, auth.companyId)).limit(1)
  const [driverRow] = await db
    .select({ firstName: users.firstName, lastName: users.lastName, homeTerminalLocationId: drivers.homeTerminalLocationId })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(eq(drivers.id, driverId))
    .limit(1)

  const reportingLocationId = card.reportingLocationId ?? driverRow?.homeTerminalLocationId ?? null
  let reportingLocationName = 'Not set'
  if (reportingLocationId) {
    const [loc] = await db
      .select({ name: locations.name, city: locations.city, state: locations.state })
      .from(locations)
      .where(eq(locations.id, reportingLocationId))
      .limit(1)
    if (loc) {
      reportingLocationName = [loc.name, [loc.city, loc.state].filter(Boolean).join(', ')].filter(Boolean).join(' — ')
    }
  }

  const timeZone = company?.timezone ?? 'America/New_York'
  const breaks = await db
    .select({
      startedAt: timecardBreaks.startedAt,
      endedAt: timecardBreaks.endedAt,
      countedAsOffDuty: timecardBreaks.countedAsOffDuty,
    })
    .from(timecardBreaks)
    .where(eq(timecardBreaks.timecardId, card.id))

  const isOpen = Boolean(card.reportedForDutyAt && !card.releasedFromDutyAt)
  const minutes = onDutyMinutes(card, breaks, now)
  const evaluation = evaluateShortHaul({
    reportedForDutyAt: card.reportedForDutyAt,
    releasedFromDutyAt: card.releasedFromDutyAt,
    now,
  })

  const [check] = await db
    .select()
    .from(timecardComplianceChecks)
    .where(eq(timecardComplianceChecks.timecardId, card.id))
    .limit(1)

  const preceding = card.status === 'OPEN'
    ? await preceding7DayMinutes(db, driverId, workDate)
    : card.preceding7DayMinutes

  const cycleMinutes = check?.rollingCycleMinutes ?? await rollingCycleMinutes(db, driverId, workDate, card.cycleType)
  const cycle = CYCLE_LIMITS[card.cycleType]

  const fmtTime = (value: Date | null) =>
    value
      ? new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(value)
      : '—'

  const record = {
    recordId: card.id,
    workDate: card.workDate,
    reportedForDuty: card.reportedForDutyAt?.toISOString() ?? null,
    releasedFromDuty: card.releasedFromDutyAt?.toISOString() ?? null,
    totalOnDutyMinutes: minutes,
    preceding7DayMinutes: preceding,
    driverId,
    companyId: auth.companyId,
  }

  return {
    recordId: card.id,
    generatedAt: now.toISOString(),
    verificationHash: verificationHash(record),
    carrierLegalName: company?.legalName ?? company?.name ?? 'Unknown carrier',
    usdotNumber: company?.usdotNumber ?? null,
    driverFullName: driverRow ? `${driverRow.firstName} ${driverRow.lastName}` : 'Unknown driver',
    workDate: card.workDate,
    reportingLocationName,
    timezoneAbbreviation: timezoneAbbreviation(now, timeZone),
    reportedForDuty: fmtTime(card.reportedForDutyAt),
    releasedFromDuty: isOpen ? 'IN PROGRESS' : fmtTime(card.releasedFromDutyAt),
    // An open day must never be presented as the final daily total (spec 14.4).
    totalOnDutyLabel: isOpen ? 'Current elapsed on-duty' : 'Total on-duty hours',
    totalOnDutyValue: formatHours(minutes),
    preceding7DayTotal: formatHours(preceding),
    cycleSummary: `${formatHours(cycleMinutes)} of ${cycle.label}`,
    isOpen,
    shortHaulStatus: evaluation.status,
    supportingChecks: [
      {
        label: '150 air-mile radius',
        value: check?.maxRecordedAirMiles != null ? `${check.maxRecordedAirMiles.toFixed(1)} mi maximum recorded` : 'Not calculated',
        evidence: 'Based on recorded stop locations only — the route between stops is not measured.',
      },
      {
        label: 'Returned to reporting location',
        value: check?.returnedToReportingLocation == null ? 'Not verified' : check.returnedToReportingLocation ? 'Yes' : 'No',
        evidence: 'Derived from recorded drop-off locations.',
      },
      {
        label: 'Released within 14 consecutive hours',
        value: evaluation.releasedWithin14Hours == null ? 'Duty tour open' : evaluation.releasedWithin14Hours ? 'Yes' : 'No',
        evidence: 'Calculated from the stored report-for-duty and release times.',
      },
      {
        label: 'Prior 10 consecutive hours off duty',
        value: check?.priorOffDutyMinutes == null
          ? 'No prior record'
          : `${formatHours(check.priorOffDutyMinutes)}${check.priorOffDutyMinutes >= REQUIRED_OFF_DUTY_MINUTES ? '' : ' — below 10 hours'}`,
        evidence: 'Calculated from the previous stored release from duty.',
      },
    ],
  }
}

/**
 * Stable integrity code over the authoritative fields. Truncated to 16 hex
 * characters so it stays readable on a printed page and can be spoken aloud.
 */
export function verificationHash(record: Record<string, unknown>): string {
  const secret = process.env.NUXT_SESSION_PASSWORD ?? 'container-tracker-dev-secret'
  const canonical = JSON.stringify(record, Object.keys(record).sort())
  return createHash('sha256')
    .update(`${secret}:${canonical}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase()
    .replace(/(.{4})(?=.)/g, '$1-')
}

/** Short timezone name (e.g. `EDT`) required on the printed record. */
function timezoneAbbreviation(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(at)
  return parts.find(p => p.type === 'timeZoneName')?.value ?? timeZone
}

/** Punch history for the ledger view, oldest first within the range. */
export async function listBreaks(db: Database, timecardId: string) {
  return db
    .select()
    .from(timecardBreaks)
    .where(eq(timecardBreaks.timecardId, timecardId))
    .orderBy(asc(timecardBreaks.startedAt))
}
