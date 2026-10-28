import { aliasedTable, and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm'
import {
  chassis,
  containers,
  containerEvents,
  driverTimeCards,
  drivers,
  locations,
  trips,
  trucks,
  users,
} from '../database/schema'
import type { Database, DbExecutor } from '../utils/db'
import type { AuthContext } from '../utils/session'
import { companyTimezone } from './tasks'
import { LIVE_TRIP_STATUSES } from './movements'
import { calendarDateInZone } from '#shared/utils/sms-task'
import { parseCoord } from '#shared/utils/geo'
import {
  annotatePingsWithSites,
  applyHeaderOverrides,
  blankTimeCardFooter,
  blankTimeCardHeader,
  cdlLabel,
  headerOverrideFields,
  isTimeCardWorkDate,
  markStopCorrections,
  mergeIncomingPing,
  mergeTimeCardStops,
  routeCustomerFromTrips,
  sanitizeTimeCardStop,
  stopsFromPings,
  stopsFromTrips,
  TIME_CARD_HEADER_FIELDS,
  TIME_CARD_STOP_MAX,
  trailerFromTrips,
  zonedDayRange,
  type TimeCardHeader,
  type TimeCardHeaderField,
  type TimeCardPing,
  type TimeCardSite,
  type TimeCardStatus,
  type TimeCardStop,
  type TimeCardTripInput,
} from '#shared/utils/time-card'

export type TimeCardView = {
  id: string
  workDate: string
  status: TimeCardStatus
  header: TimeCardHeader
  stops: TimeCardStop[]
  pingCount: number
  live: boolean
}

export type TimeCardListItem = {
  workDate: string
  status: TimeCardStatus
  stopCount: number
  totalOnDutyHours: string
}

function asStops(value: unknown): TimeCardStop[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => sanitizeTimeCardStop(item as Partial<TimeCardStop>))
    .filter((item): item is TimeCardStop => Boolean(item))
}

function asPings(value: unknown): TimeCardPing[] {
  if (!Array.isArray(value)) return []
  const pings: TimeCardPing[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as TimeCardPing
    const latitude = Number(row.latitude)
    const longitude = Number(row.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    if (!row.at) continue
    pings.push({
      at: String(row.at),
      latitude,
      longitude,
      accuracyMeters: row.accuracyMeters == null ? null : Number(row.accuracyMeters),
      locationId: row.locationId ? String(row.locationId) : null,
      locationName: row.locationName ? String(row.locationName) : null,
    })
  }
  return pings
}

function asHeader(value: unknown, workDate: string): TimeCardHeader {
  const blank = blankTimeCardHeader(workDate)
  if (!value || typeof value !== 'object') return blank
  const row = value as Record<string, unknown>
  const next = { ...blank }
  for (const key of Object.keys(blank) as (keyof TimeCardHeader)[]) {
    if (typeof row[key] === 'string') next[key] = row[key] as string
  }
  next.date = blank.date
  return next
}

function asOverrides(value: unknown): TimeCardHeaderField[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is TimeCardHeaderField =>
    TIME_CARD_HEADER_FIELDS.includes(item as TimeCardHeaderField),
  )
}

function requireWorkDate(workDate: string): string {
  const trimmed = workDate.trim()
  if (!isTimeCardWorkDate(trimmed)) {
    throw createError({ statusCode: 400, statusMessage: 'Use a work date like 2026-10-28.' })
  }
  return trimmed
}

function requireDriverAuth(auth: AuthContext): AuthContext & { driverId: string } {
  if (!auth.driverId) {
    throw createError({ statusCode: 403, statusMessage: 'Driver access required.' })
  }
  return auth as AuthContext & { driverId: string }
}

async function loadSites(db: DbExecutor, companyId: string): Promise<TimeCardSite[]> {
  const rows = await db
    .select({
      id: locations.id,
      name: locations.name,
      city: locations.city,
      state: locations.state,
      latitude: locations.latitude,
      longitude: locations.longitude,
    })
    .from(locations)
    .where(and(
      eq(locations.companyId, companyId),
      isNull(locations.deletedAt),
    ))

  return rows.map(row => ({
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    latitude: parseCoord(row.latitude),
    longitude: parseCoord(row.longitude),
  }))
}

async function loadDayTrips(
  db: DbExecutor,
  auth: AuthContext & { driverId: string },
  workDate: string,
  timeZone: string,
): Promise<TimeCardTripInput[]> {
  const { start, end } = zonedDayRange(workDate, timeZone)
  const origin = aliasedTable(locations, 'time_card_origin')
  const destination = aliasedTable(locations, 'time_card_destination')
  const rows = await db
    .select({
      id: trips.id,
      kind: trips.kind,
      isLoaded: trips.isLoaded,
      customer: trips.customer,
      createdAt: trips.createdAt,
      pickedUpAt: trips.pickedUpAt,
      droppedOffAt: trips.droppedOffAt,
      originLocationId: trips.originLocationId,
      destinationLocationId: trips.destinationLocationId,
      originName: origin.name,
      originCity: origin.city,
      originState: origin.state,
      destinationName: destination.name,
      destinationCity: destination.city,
      destinationState: destination.state,
      containerNumber: containers.number,
      chassisNumber: chassis.number,
    })
    .from(trips)
    .leftJoin(containers, eq(containers.id, trips.containerId))
    .leftJoin(chassis, eq(chassis.id, trips.chassisId))
    .leftJoin(origin, eq(origin.id, trips.originLocationId))
    .leftJoin(destination, eq(destination.id, trips.destinationLocationId))
    .where(and(
      eq(trips.companyId, auth.companyId),
      eq(trips.driverId, auth.driverId),
      ne(trips.status, 'CANCELLED'),
      or(
        and(gte(trips.createdAt, new Date(start.getTime() - 36 * 3600 * 1000)), lte(trips.createdAt, new Date(end.getTime() + 12 * 3600 * 1000))),
        and(isNotNull(trips.pickedUpAt), gte(trips.pickedUpAt, start), lte(trips.pickedUpAt, end)),
        and(isNotNull(trips.droppedOffAt), gte(trips.droppedOffAt, start), lte(trips.droppedOffAt, end)),
      ),
    ))

  return rows
    .filter((row) => {
      const stamps = [row.createdAt, row.pickedUpAt, row.droppedOffAt].filter(Boolean) as Date[]
      return stamps.some(stamp => calendarDateInZone(stamp, timeZone) === workDate)
    })
    .map(row => ({
      id: row.id,
      kind: row.kind,
      isLoaded: row.isLoaded,
      customer: row.customer,
      createdAt: row.createdAt,
      pickedUpAt: row.pickedUpAt,
      droppedOffAt: row.droppedOffAt,
      originLocationId: row.originLocationId,
      destinationLocationId: row.destinationLocationId,
      originName: row.originName,
      originCity: row.originCity,
      originState: row.originState,
      destinationName: row.destinationName,
      destinationCity: row.destinationCity,
      destinationState: row.destinationState,
      containerNumber: row.containerNumber,
      chassisNumber: row.chassisNumber,
    }))
}

async function loadEventPings(
  db: DbExecutor,
  auth: AuthContext & { driverId: string },
  workDate: string,
  timeZone: string,
  sites: readonly TimeCardSite[],
): Promise<TimeCardPing[]> {
  const { start, end } = zonedDayRange(workDate, timeZone)
  const rows = await db
    .select({
      at: containerEvents.occurredAt,
      latitude: containerEvents.gpsLatitude,
      longitude: containerEvents.gpsLongitude,
      accuracyMeters: containerEvents.gpsAccuracyMeters,
      locationId: containerEvents.locationId,
    })
    .from(containerEvents)
    .where(and(
      eq(containerEvents.companyId, auth.companyId),
      eq(containerEvents.actorDriverId, auth.driverId),
      isNotNull(containerEvents.gpsLatitude),
      isNotNull(containerEvents.gpsLongitude),
      gte(containerEvents.occurredAt, start),
      lte(containerEvents.occurredAt, end),
    ))
    .orderBy(containerEvents.occurredAt)

  const siteById = new Map(sites.map(site => [site.id, site]))
  const pings: TimeCardPing[] = []
  for (const row of rows) {
    const latitude = parseCoord(row.latitude)
    const longitude = parseCoord(row.longitude)
    if (latitude == null || longitude == null) continue
    const site = row.locationId ? siteById.get(row.locationId) : null
    pings.push({
      at: row.at.toISOString(),
      latitude,
      longitude,
      accuracyMeters: row.accuracyMeters ?? null,
      locationId: site?.id ?? null,
      locationName: site?.name ?? null,
    })
  }
  return annotatePingsWithSites(pings, sites)
}

async function loadDriverHeaderBits(
  db: DbExecutor,
  auth: AuthContext & { driverId: string },
  dayTrips: readonly TimeCardTripInput[],
): Promise<Pick<TimeCardHeader, 'driverName' | 'truckUnit' | 'trailerNumber' | 'cdl' | 'employeeId' | 'routeCustomer'>> {
  const [driver] = await db
    .select({
      driverCode: drivers.driverCode,
      cdlNumber: drivers.cdlNumber,
      cdlState: drivers.cdlState,
      preferredTruckId: drivers.preferredTruckId,
      firstName: users.firstName,
      lastName: users.lastName,
    })
    .from(drivers)
    .innerJoin(users, eq(users.id, drivers.userId))
    .where(eq(drivers.id, auth.driverId))
    .limit(1)

  let truckVin = ''
  if (driver?.preferredTruckId) {
    const [truck] = await db
      .select({ vin: trucks.vin })
      .from(trucks)
      .where(eq(trucks.id, driver.preferredTruckId))
      .limit(1)
    truckVin = truck?.vin?.trim() || ''
  }

  return {
    driverName: [driver?.firstName, driver?.lastName].filter(Boolean).join(' ').trim() || auth.fullName,
    truckUnit: truckVin,
    trailerNumber: trailerFromTrips(dayTrips),
    cdl: cdlLabel(driver?.cdlNumber, driver?.cdlState),
    employeeId: driver?.driverCode?.trim() || '',
    routeCustomer: routeCustomerFromTrips(dayTrips),
  }
}

async function ensureRow(
  db: DbExecutor,
  auth: AuthContext & { driverId: string },
  workDate: string,
) {
  const [existing] = await db
    .select()
    .from(driverTimeCards)
    .where(and(
      eq(driverTimeCards.companyId, auth.companyId),
      eq(driverTimeCards.driverId, auth.driverId),
      eq(driverTimeCards.workDate, workDate),
    ))
    .limit(1)

  if (existing) return existing

  await db.insert(driverTimeCards).values({
    companyId: auth.companyId,
    driverId: auth.driverId,
    workDate,
    status: 'OPEN',
    stops: [],
    pings: [],
    header: blankTimeCardHeader(workDate),
    headerOverrides: [],
  }).onConflictDoNothing({ target: [driverTimeCards.driverId, driverTimeCards.workDate] })

  const [row] = await db
    .select()
    .from(driverTimeCards)
    .where(and(
      eq(driverTimeCards.companyId, auth.companyId),
      eq(driverTimeCards.driverId, auth.driverId),
      eq(driverTimeCards.workDate, workDate),
    ))
    .limit(1)

  if (!row) {
    throw createError({ statusCode: 500, statusMessage: 'Could not open today\'s time card.' })
  }
  return row
}

function toView(
  row: typeof driverTimeCards.$inferSelect,
  live: boolean,
): TimeCardView {
  const workDate = row.workDate
  const stops = asStops(row.stops)
  const header = asHeader(row.header, workDate)
  return {
    id: row.id,
    workDate,
    status: row.status === 'COMPLETED' ? 'COMPLETED' : 'OPEN',
    header,
    stops,
    pingCount: asPings(row.pings).length,
    live,
  }
}

export async function listDriverTimeCards(
  db: Database,
  auth: AuthContext,
  limit = 60,
): Promise<TimeCardListItem[]> {
  const driverAuth = requireDriverAuth(auth)
  const rows = await db
    .select({
      workDate: driverTimeCards.workDate,
      status: driverTimeCards.status,
      stops: driverTimeCards.stops,
      header: driverTimeCards.header,
    })
    .from(driverTimeCards)
    .where(and(
      eq(driverTimeCards.companyId, driverAuth.companyId),
      eq(driverTimeCards.driverId, driverAuth.driverId),
    ))
    .orderBy(desc(driverTimeCards.workDate))
    .limit(limit)

  return rows.map((row) => {
    const stops = asStops(row.stops)
    const header = asHeader(row.header, row.workDate)
    return {
      workDate: row.workDate,
      status: row.status === 'COMPLETED' ? 'COMPLETED' : 'OPEN',
      stopCount: stops.length,
      totalOnDutyHours: header.totalOnDutyHours,
    }
  })
}

export async function syncDriverTimeCard(
  db: DbExecutor,
  auth: AuthContext,
  workDateInput: string,
): Promise<TimeCardView> {
  const driverAuth = requireDriverAuth(auth)
  const workDate = requireWorkDate(workDateInput)
  const timeZone = await companyTimezone(db, driverAuth.companyId)
  const row = await ensureRow(db, driverAuth, workDate)
  const sites = await loadSites(db, driverAuth.companyId)
  const dayTrips = await loadDayTrips(db, driverAuth, workDate, timeZone)
  const storedPings = annotatePingsWithSites(asPings(row.pings), sites)
  const eventPings = await loadEventPings(db, driverAuth, workDate, timeZone, sites)

  let pings = storedPings
  for (const ping of eventPings) pings = mergeIncomingPing(pings, ping)
  pings = annotatePingsWithSites(pings, sites)

  const auto = mergeTimeCardStops(
    [...stopsFromTrips(dayTrips, timeZone), ...stopsFromPings(pings, timeZone)],
    [],
  )
  const stops = mergeTimeCardStops(auto, asStops(row.stops))
  const bits = await loadDriverHeaderBits(db, driverAuth, dayTrips)
  const savedHeader = asHeader(row.header, workDate)
  const autoHeader: TimeCardHeader = {
    ...blankTimeCardHeader(workDate),
    ...bits,
    startOdometer: savedHeader.startOdometer,
    endOdometer: savedHeader.endOdometer,
    dispatcher: savedHeader.dispatcher,
  }
  const header = {
    ...applyHeaderOverrides(autoHeader, savedHeader, asOverrides(row.headerOverrides)),
    date: blankTimeCardHeader(workDate).date,
    ...blankTimeCardFooter(),
  }
  const status: TimeCardStatus = 'OPEN'
  const now = new Date()

  const [updated] = await db
    .update(driverTimeCards)
    .set({
      status,
      stops,
      pings,
      header,
      updatedAt: now,
    })
    .where(eq(driverTimeCards.id, row.id))
    .returning()

  const live = await driverIsLive(db, driverAuth.companyId, driverAuth.driverId)
  return toView(updated ?? { ...row, status, stops, pings, header, updatedAt: now }, live)
}

async function driverIsLive(db: DbExecutor, companyId: string, driverId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(
      eq(trips.companyId, companyId),
      eq(trips.driverId, driverId),
      inArray(trips.status, [...LIVE_TRIP_STATUSES]),
    ))
    .limit(1)
  return Boolean(row)
}

export async function getDriverTimeCard(
  db: Database,
  auth: AuthContext,
  workDate: string,
): Promise<TimeCardView> {
  return syncDriverTimeCard(db, auth, workDate)
}

export async function recordTimeCardPing(
  db: Database,
  auth: AuthContext,
  input: { latitude: number, longitude: number, accuracyMeters?: number | null, at?: string | Date | null },
): Promise<{ accepted: boolean, live: boolean, workDate: string, card: TimeCardView }> {
  const driverAuth = requireDriverAuth(auth)
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    throw createError({ statusCode: 422, statusMessage: 'A GPS fix is required.' })
  }
  const timeZone = await companyTimezone(db, driverAuth.companyId)
  const at = input.at ? new Date(input.at) : new Date()
  const workDate = calendarDateInZone(Number.isNaN(at.getTime()) ? new Date() : at, timeZone)
  const row = await ensureRow(db, driverAuth, workDate)
  const sites = await loadSites(db, driverAuth.companyId)
  const ping: TimeCardPing = {
    at: (Number.isNaN(at.getTime()) ? new Date() : at).toISOString(),
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters ?? null,
  }
  const pings = mergeIncomingPing(
    annotatePingsWithSites(asPings(row.pings), sites),
    annotatePingsWithSites([ping], sites)[0]!,
  )
  await db
    .update(driverTimeCards)
    .set({ pings, updatedAt: new Date() })
    .where(eq(driverTimeCards.id, row.id))

  const card = await syncDriverTimeCard(db, driverAuth, workDate)
  return { accepted: true, live: card.live, workDate, card }
}

export async function patchDriverTimeCard(
  db: Database,
  auth: AuthContext,
  workDateInput: string,
  body: {
    header?: Partial<TimeCardHeader>
    stops?: Array<Partial<TimeCardStop>>
  },
): Promise<TimeCardView> {
  const driverAuth = requireDriverAuth(auth)
  const workDate = requireWorkDate(workDateInput)
  const current = await syncDriverTimeCard(db, driverAuth, workDate)
  const timeZone = await companyTimezone(db, driverAuth.companyId)
  const row = await ensureRow(db, driverAuth, workDate)
  const dayTrips = await loadDayTrips(db, driverAuth, workDate, timeZone)
  const sites = await loadSites(db, driverAuth.companyId)
  const pings = annotatePingsWithSites(asPings(row.pings), sites)
  const auto = mergeTimeCardStops(
    [...stopsFromTrips(dayTrips, timeZone), ...stopsFromPings(pings, timeZone)],
    [],
  )

  const submittedStops = Array.isArray(body.stops)
    ? body.stops
        .map(item => sanitizeTimeCardStop(item))
        .filter((item): item is TimeCardStop => Boolean(item))
        .slice(0, TIME_CARD_STOP_MAX)
    : asStops(row.stops)
  const stops = mergeTimeCardStops(auto, markStopCorrections(submittedStops, auto))

  const savedHeader = asHeader(row.header, workDate)
  const submittedHeader = body.header ?? {}
  const bits = await loadDriverHeaderBits(db, driverAuth, dayTrips)
  const autoHeader: TimeCardHeader = {
    ...blankTimeCardHeader(workDate),
    ...bits,
    startOdometer: savedHeader.startOdometer,
    endOdometer: savedHeader.endOdometer,
    dispatcher: savedHeader.dispatcher,
  }
  const mergedSubmitted: Partial<TimeCardHeader> = {}
  for (const field of TIME_CARD_HEADER_FIELDS) {
    if (typeof submittedHeader[field] === 'string') {
      mergedSubmitted[field] = submittedHeader[field]!.trim().slice(0, 80)
    }
  }
  const overrides = headerOverrideFields(autoHeader, { ...savedHeader, ...mergedSubmitted })
  const header = {
    ...applyHeaderOverrides(autoHeader, { ...savedHeader, ...mergedSubmitted }, overrides),
    date: blankTimeCardHeader(workDate).date,
    ...blankTimeCardFooter(),
  }
  const status: TimeCardStatus = 'OPEN'

  const [updated] = await db
    .update(driverTimeCards)
    .set({
      status,
      stops,
      header,
      headerOverrides: overrides,
      updatedAt: new Date(),
    })
    .where(eq(driverTimeCards.id, row.id))
    .returning()

  return toView(updated ?? { ...row, status, stops, header, headerOverrides: overrides }, current.live)
}

export async function syncTodayTimeCardQuietly(
  db: DbExecutor,
  auth: AuthContext,
  at: Date = new Date(),
): Promise<void> {
  if (!auth.driverId) return
  try {
    const timeZone = await companyTimezone(db, auth.companyId)
    const workDate = calendarDateInZone(at, timeZone)
    await syncDriverTimeCard(db, auth, workDate)
  }
  catch (error) {
    console.warn('[time-card] could not sync after a trip change', error)
  }
}
