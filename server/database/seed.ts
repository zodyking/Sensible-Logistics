/**
 * Demo data for local development.
 *
 * Idempotent: re-running updates the demo company in place rather than
 * duplicating it. Credentials are documented in README.md.
 *
 *   npm run db:seed
 */

import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { Hash } from '@adonisjs/hash'
import { Scrypt } from '@adonisjs/hash/drivers/scrypt'
import { and, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { computeCheckDigit, normalizeContainerNumber, validateContainerNumber } from '../../shared/utils/iso6346'
import { bboxAround, localMetersFromLatLng, offsetLatLng, polygonFromBbox } from '../../shared/utils/geo'
import * as schema from './schema'

const {
  chassis,
  companies,
  companyMemberships,
  containerEvents,
  containerPlacements,
  containers,
  driverTimecards,
  drivers,
  locations,
  timecardComplianceChecks,
  trips,
  trucks,
  users,
} = schema

const DEMO_COMPANY = process.env.NUXT_COMPANY_NAME?.trim() || 'Sensible Drayage Co.'
/** Mirrors the app: the invite code comes from the environment, never the code. */
const INVITE_CODE = (process.env.NUXT_COMPANY_INVITE_CODE?.trim() || 'SENSIBLE')
  .toUpperCase()
  .replace(/[\s-]/g, '')
const ADMIN_EMAIL = 'admin@sensible.test'
const DRIVER_EMAIL = 'driver@sensible.test'
const PASSWORD = 'Password123!'

const connectionString
  = process.env.DATABASE_URL ?? 'postgresql://tracker:tracker@localhost:5432/container_tracker'

/**
 * Same scrypt hasher nuxt-auth-utils uses at runtime, with the module's default
 * options, so seeded accounts log in through the normal flow.
 */
const hasher = new Hash(new Scrypt({}))

/** Builds a valid ISO 6346 number from an owner prefix and 6-digit serial. */
function containerNumber(prefix: string, serial: string): string {
  const base = `${prefix}${serial}`
  return `${base}${computeCheckDigit(base)}`
}

function daysAgo(days: number, hour = 8, minute = 0): Date {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  date.setUTCHours(hour, minute, 0, 0)
  return date
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * `users_email_key` is unique on `lower(email)`, and ON CONFLICT cannot target an
 * expression index, so the demo accounts are matched case-insensitively by hand
 * to keep re-runs idempotent.
 */
async function upsertUser(
  db: NodePgDatabase<typeof schema>,
  values: typeof schema.users.$inferInsert,
) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${values.email})`)
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({ passwordHash: values.passwordHash, emailVerifiedAt: values.emailVerifiedAt })
      .where(eq(users.id, existing.id))
      .returning()
    return updated
  }

  const [created] = await db.insert(users).values(values).returning()
  return created
}

async function main() {
  const pool = new Pool({ connectionString })
  const db = drizzle(pool, { schema })

  console.log(`Seeding ${connectionString.replace(/:\/\/.*@/, '://***@')}`)

  const passwordHash = await hasher.make(PASSWORD)

  /* ---- Company ------------------------------------------------- */
  const [company] = await db
    .insert(companies)
    .values({
      name: DEMO_COMPANY,
      legalName: 'Sensible Drayage Company LLC',
      usdotNumber: '3412887',
      inviteCode: INVITE_CODE,
      timezone: 'America/New_York',
      cycleType: 'SEVENTY_EIGHT',
    })
    .onConflictDoUpdate({ target: companies.inviteCode, set: { name: DEMO_COMPANY } })
    .returning()

  if (!company) throw new Error('Failed to create the demo company.')

  /* ---- Users --------------------------------------------------- */
  // Demo accounts are pre-verified so they can sign in without SMTP.
  const verifiedAt = new Date()

  const admin = await upsertUser(db, {
    email: ADMIN_EMAIL,
    passwordHash,
    firstName: 'Dana',
    lastName: 'Reyes',
    mobileNumber: '+19545550142',
    emailVerifiedAt: verifiedAt,
  })

  const driverUser = await upsertUser(db, {
    email: DRIVER_EMAIL,
    passwordHash,
    firstName: 'Marcus',
    lastName: 'Vega',
    mobileNumber: '+19545550187',
    emailVerifiedAt: verifiedAt,
  })

  if (!admin || !driverUser) throw new Error('Failed to create the demo users.')

  await db
    .insert(companyMemberships)
    .values([
      { companyId: company.id, userId: admin.id, role: 'ADMIN', status: 'ACTIVE' },
      { companyId: company.id, userId: driverUser.id, role: 'DRIVER', status: 'ACTIVE' },
    ])
    .onConflictDoNothing()

  /* ---- Locations ----------------------------------------------- */
  const locationSeed = [
    {
      name: 'Port Everglades Terminal 3',
      type: 'MARINE_TERMINAL' as const,
      addressLine1: '1850 Eller Drive',
      city: 'Fort Lauderdale',
      state: 'FL',
      postalCode: '33316',
      latitude: 26.093,
      longitude: -80.118,
      halfMeters: 90,
      capacity: null,
      appointmentRequired: true,
      hours: 'Mon–Fri 06:00–17:00',
    },
    {
      name: 'Sensible Yard — Davie',
      type: 'COMPANY_YARD' as const,
      addressLine1: '4400 SW 42nd Street',
      city: 'Davie',
      state: 'FL',
      postalCode: '33314',
      latitude: 26.068,
      longitude: -80.247,
      halfMeters: 70,
      capacity: 240,
      appointmentRequired: false,
      hours: 'Open 24 hours',
    },
    {
      name: 'Medley Distribution Center',
      type: 'CUSTOMER' as const,
      addressLine1: '9200 NW 105th Way',
      city: 'Medley',
      state: 'FL',
      postalCode: '33178',
      latitude: 25.862,
      longitude: -80.34,
      halfMeters: 55,
      capacity: 60,
      appointmentRequired: true,
      hours: 'Mon–Sat 07:00–19:00',
    },
    {
      name: 'Coastal Tile Imports',
      type: 'CUSTOMER' as const,
      addressLine1: '11800 NW 102nd Place',
      city: 'Medley',
      state: 'FL',
      postalCode: '33178',
      latitude: '25.8680000',
      longitude: '-80.3520000',
      capacity: 12,
      appointmentRequired: true,
      hours: 'Mon–Fri 07:00–16:00',
    },
    {
      name: 'FEC Rail Ramp — Hialeah',
      type: 'RAIL_TERMINAL' as const,
      addressLine1: '7200 NW 37th Avenue',
      city: 'Miami',
      state: 'FL',
      postalCode: '33147',
      latitude: '25.8470000',
      longitude: '-80.2560000',
      capacity: null,
      appointmentRequired: true,
      hours: 'Mon–Sat 06:00–18:00',
    },
    {
      name: 'Hialeah Empty Depot',
      type: 'COMPANY_YARD' as const,
      addressLine1: '3050 E 11th Avenue',
      city: 'Hialeah',
      state: 'FL',
      postalCode: '33013',
      latitude: 25.846,
      longitude: -80.28,
      halfMeters: 80,
      capacity: 400,
      appointmentRequired: false,
      hours: 'Mon–Fri 07:00–16:00',
    },
  ]

  const locationIds: Record<string, string> = {}
  const locationBoxes: Record<string, ReturnType<typeof bboxAround>> = {}

  for (const seed of locationSeed) {
    const box = bboxAround(seed.latitude, seed.longitude, seed.halfMeters)
    const boundary = polygonFromBbox(box)
    locationBoxes[seed.name] = box

    const existing = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.companyId, company.id), eq(locations.name, seed.name)))
      .limit(1)

    if (existing[0]) {
      locationIds[seed.name] = existing[0].id
      await db
        .update(locations)
        .set({
          type: seed.type,
          latitude: seed.latitude.toFixed(7),
          longitude: seed.longitude.toFixed(7),
          boundary,
          updatedAt: new Date(),
        })
        .where(eq(locations.id, existing[0].id))
      continue
    }

    const [created] = await db
      .insert(locations)
      .values({
        companyId: company.id,
        name: seed.name,
        type: seed.type,
        addressLine1: seed.addressLine1,
        city: seed.city,
        state: seed.state,
        postalCode: seed.postalCode,
        country: 'US',
        normalizedAddress: `${seed.addressLine1} ${seed.city} ${seed.state} ${seed.postalCode}`
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
        latitude: seed.latitude.toFixed(7),
        longitude: seed.longitude.toFixed(7),
        boundary,
        capacity: seed.capacity,
        appointmentRequired: seed.appointmentRequired,
        hours: seed.hours,
        timezone: 'America/New_York',
        status: 'ACTIVE',
        createdByUserId: admin.id,
      })
      .returning({ id: locations.id })

    if (created) locationIds[seed.name] = created.id
  }

  const yardId = locationIds['Sensible Yard — Davie']!
  const portId = locationIds['Port Everglades Terminal 3']!
  const depotId = locationIds['Hialeah Empty Depot']!
  const customerId = locationIds['Coastal Tile Imports']!
  const railId = locationIds['FEC Rail Ramp — Hialeah']!

  /* ---- Driver + truck ------------------------------------------ */
  const [driver] = await db
    .insert(drivers)
    .values({
      companyId: company.id,
      userId: driverUser.id,
      driverCode: 'D-104',
      cdlNumber: 'V26041887210',
      cdlState: 'FL',
      homeTerminalLocationId: yardId,
      status: 'AVAILABLE',
    })
    .onConflictDoUpdate({
      target: [drivers.companyId, drivers.userId],
      set: { homeTerminalLocationId: yardId },
    })
    .returning()

  if (!driver) throw new Error('Failed to create the demo driver.')

  await db
    .insert(trucks)
    .values({
      companyId: company.id,
      unitNumber: 'T-118',
      plate: 'FL-8842QC',
      assignedDriverId: driver.id,
    })
    .onConflictDoNothing()

  /* ---- Chassis -------------------------------------------------- */
  const chassisSeed = [
    { number: 'TRAC 481029', provider: 'TRAC Intermodal', size: `40'` },
    { number: 'DCLI 220144', provider: 'DCLI', size: `20'/40'` },
    { number: 'FLXI 907712', provider: 'Flexi-Van', size: `45'` },
  ]

  const chassisIds: string[] = []

  for (const seed of chassisSeed) {
    const normalized = seed.number.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    const [row] = await db
      .insert(chassis)
      .values({
        companyId: company.id,
        number: seed.number,
        numberNormalized: normalized,
        provider: seed.provider,
        sizeCompatibility: seed.size,
        status: 'AVAILABLE',
        currentLocationId: yardId,
      })
      .onConflictDoUpdate({
        target: [chassis.companyId, chassis.numberNormalized],
        set: { provider: seed.provider },
      })
      .returning({ id: chassis.id })

    if (row) chassisIds.push(row.id)
  }

  /* ---- Containers ----------------------------------------------- */
  type ContainerSeed = Pick<
    schema.NewContainer,
    'containerType' | 'equipmentType' | 'isLoaded' | 'containerStatus' | 'activePoolState' | 'currentLocationId'
  > & Partial<Pick<
    schema.NewContainer,
    'sealNumber' | 'steamshipLine' | 'commodity' | 'lastFreeDay' | 'customerReference' | 'isReefer' | 'isUrgent'
  >> & { number: string }

  const containerSeed: ContainerSeed[] = [
    {
      number: containerNumber('MSCU', '452189'),
      containerType: 'ZIM' as const,
      equipmentType: 'HC_40' as const,
      isLoaded: true,
      containerStatus: 'AT_YARD' as const,
      activePoolState: 'AT_LOCATION' as const,
      currentLocationId: yardId,
      sealNumber: 'SL-778213',
      steamshipLine: 'ZIM',
      commodity: 'Ceramic tile',
      lastFreeDay: isoDate(daysAgo(-3)),
    },
    {
      number: containerNumber('TGHU', '731004'),
      containerType: 'CMA' as const,
      equipmentType: 'DRY_40' as const,
      isLoaded: false,
      containerStatus: 'AVAILABLE' as const,
      activePoolState: 'AT_LOCATION' as const,
      currentLocationId: depotId,
      steamshipLine: 'CMA CGM',
    },
    {
      number: containerNumber('CAIU', '298455'),
      containerType: 'TROPICAL' as const,
      equipmentType: 'REEFER' as const,
      isLoaded: true,
      containerStatus: 'AVAILABLE' as const,
      activePoolState: 'AT_LOCATION' as const,
      currentLocationId: portId,
      isReefer: true,
      isUrgent: true,
      steamshipLine: 'Tropical Shipping',
      commodity: 'Produce',
      lastFreeDay: isoDate(daysAgo(-1)),
    },
    {
      number: containerNumber('HLXU', '884560'),
      containerType: 'CMA' as const,
      equipmentType: 'DRY_40' as const,
      isLoaded: false,
      containerStatus: 'LOADING' as const,
      activePoolState: 'AT_LOCATION' as const,
      currentLocationId: customerId,
      steamshipLine: 'CMA CGM',
      commodity: 'Packaged goods',
      customerReference: 'PO-44812',
    },
    {
      number: containerNumber('KOCU', '610233'),
      containerType: 'KING_OCEAN' as const,
      equipmentType: 'DRY_20' as const,
      isLoaded: false,
      containerStatus: 'RETURNED' as const,
      activePoolState: 'INACTIVE' as const,
      currentLocationId: railId,
      steamshipLine: 'King Ocean',
    },
    {
      number: containerNumber('TCKU', '118902'),
      containerType: 'TROPICAL' as const,
      equipmentType: 'DRY_40' as const,
      isLoaded: false,
      activePoolState: 'AT_LOCATION' as const,
      currentLocationId: yardId,
      steamshipLine: 'Tropical Shipping',
    },
    {
      number: containerNumber('CMAU', '552017'),
      containerType: 'CMA' as const,
      equipmentType: 'HC_40' as const,
      isLoaded: true,
      activePoolState: 'AT_LOCATION' as const,
      currentLocationId: yardId,
      steamshipLine: 'CMA CGM',
    },
    {
      number: containerNumber('ZIMU', '773401'),
      containerType: 'ZIM' as const,
      equipmentType: 'DRY_20' as const,
      isLoaded: false,
      activePoolState: 'AT_LOCATION' as const,
      currentLocationId: depotId,
      steamshipLine: 'ZIM',
    },
  ]

  const containerIds: Record<string, string> = {}

  for (const seed of containerSeed) {
    const normalized = normalizeContainerNumber(seed.number)
    const [row] = await db
      .insert(containers)
      .values({
        companyId: company.id,
        number: seed.number,
        numberNormalized: normalized,
        checkDigitValid: validateContainerNumber(seed.number).valid,
        containerType: seed.containerType,
        equipmentType: seed.equipmentType,
        isLoaded: seed.isLoaded,
        containerStatus: seed.containerStatus,
        sealNumber: seed.sealNumber ?? null,
        steamshipLine: seed.steamshipLine ?? null,
        commodity: seed.commodity ?? null,
        customerReference: seed.customerReference ?? null,
        lastFreeDay: seed.lastFreeDay ?? null,
        isReefer: seed.isReefer ?? false,
        isUrgent: seed.isUrgent ?? false,
        activePoolState: seed.activePoolState,
        currentLocationId: seed.currentLocationId,
        activatedAt: seed.activePoolState === 'INACTIVE' ? null : daysAgo(4),
        lastActivityAt: daysAgo(1, 14),
        createdByUserId: admin.id,
      })
      .onConflictDoUpdate({
        target: [containers.companyId, containers.numberNormalized],
        set: {
          lastActivityAt: daysAgo(1, 14),
          containerStatus: seed.containerStatus,
          isLoaded: seed.isLoaded,
          activePoolState: seed.activePoolState,
          currentLocationId: seed.currentLocationId,
        },
      })
      .returning({ id: containers.id })

    if (row) containerIds[normalized] = row.id
  }

  /* ---- Map placements (OpenStreetMap pins inside each fence) ------ */
  const placementSeeds: Array<{
    number: string
    locationName: string
    east: number
    north: number
    rotation: number
  }> = [
    { number: containerSeed[0]!.number, locationName: 'Sensible Yard — Davie', east: -12, north: 18, rotation: 90 },
    { number: containerNumber('TCKU', '118902'), locationName: 'Sensible Yard — Davie', east: 10, north: 16, rotation: 0 },
    { number: containerNumber('CMAU', '552017'), locationName: 'Sensible Yard — Davie', east: 10, north: 4, rotation: 0 },
    { number: containerNumber('CAIU', '298455'), locationName: 'Port Everglades Terminal 3', east: -8, north: 12, rotation: 80 },
    { number: containerNumber('HLXU', '884560'), locationName: 'Medley Distribution Center', east: 6, north: 8, rotation: 12 },
    { number: containerNumber('TGHU', '731004'), locationName: 'Hialeah Empty Depot', east: -14, north: 10, rotation: 95 },
    { number: containerNumber('ZIMU', '773401'), locationName: 'Hialeah Empty Depot', east: -14, north: 0, rotation: 95 },
  ]

  for (const seed of placementSeeds) {
    const containerId = containerIds[normalizeContainerNumber(seed.number)]
    const locationId = locationIds[seed.locationName]
    const box = locationBoxes[seed.locationName]
    if (!containerId || !locationId || !box) continue

    const pin = offsetLatLng((box.north + box.south) / 2, (box.west + box.east) / 2, seed.east, seed.north)
    const local = localMetersFromLatLng(box, pin.latitude, pin.longitude)

    const [live] = await db
      .select({ id: containerPlacements.id })
      .from(containerPlacements)
      .where(and(
        eq(containerPlacements.containerId, containerId),
        eq(containerPlacements.locationId, locationId),
        sql`${containerPlacements.supersededAt} is null`,
      ))
      .limit(1)

    if (live) {
      await db
        .update(containerPlacements)
        .set({
          x: local.x,
          y: local.y,
          rotation: seed.rotation,
          latitude: pin.latitude.toFixed(7),
          longitude: pin.longitude.toFixed(7),
        })
        .where(eq(containerPlacements.id, live.id))
      continue
    }

    await db.insert(containerPlacements).values({
      companyId: company.id,
      containerId,
      locationId,
      x: local.x,
      y: local.y,
      rotation: seed.rotation,
      latitude: pin.latitude.toFixed(7),
      longitude: pin.longitude.toFixed(7),
      placedByUserId: admin.id,
    })
  }

  /* ---- Service-life pickup / drop-off histories ------------------ */
  async function seedCompletedTrip(input: {
    reference: string
    containerId: string
    chassisId: string | null
    originId: string
    destinationId: string
    pickedUpAt: Date
    droppedOffAt: Date
    isLoaded: boolean
    isFinalRelease: boolean
    customer?: string
    notes?: string
  }) {
    const existing = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.companyId, company.id), eq(trips.reference, input.reference)))
      .limit(1)
    if (existing[0]) return existing[0].id

    const [trip] = await db
      .insert(trips)
      .values({
        companyId: company.id,
        reference: input.reference,
        driverId: driver.id,
        containerId: input.containerId,
        chassisId: input.chassisId,
        originLocationId: input.originId,
        destinationLocationId: input.destinationId,
        status: 'COMPLETED',
        isLoaded: input.isLoaded,
        isFinalRelease: input.isFinalRelease,
        customer: input.customer ?? null,
        pickedUpAt: input.pickedUpAt,
        droppedOffAt: input.droppedOffAt,
        completedAt: input.droppedOffAt,
        driverNotes: input.notes ?? null,
      })
      .returning()

    if (!trip) return null

    await db.insert(containerEvents).values([
      {
        id: randomUUID(),
        companyId: company.id,
        containerId: input.containerId,
        eventType: 'PICKUP_CONFIRMED',
        occurredAt: input.pickedUpAt,
        actorUserId: driverUser.id,
        actorDriverId: driver.id,
        source: 'MANUAL',
        tripId: trip.id,
        locationId: input.originId,
        chassisId: input.chassisId,
        payload: {},
      },
      {
        id: randomUUID(),
        companyId: company.id,
        containerId: input.containerId,
        eventType: 'DROPOFF_CONFIRMED',
        occurredAt: input.droppedOffAt,
        actorUserId: driverUser.id,
        actorDriverId: driver.id,
        source: 'MANUAL',
        tripId: trip.id,
        locationId: input.destinationId,
        chassisId: input.chassisId,
        payload: { isFinalRelease: input.isFinalRelease },
      },
    ])

    return trip.id
  }

  const yardContainerId = containerIds[normalizeContainerNumber(containerSeed[0]!.number)]!
  const loadingContainerId = containerIds[normalizeContainerNumber(containerSeed[3]!.number)]!
  const returnedContainerId = containerIds[normalizeContainerNumber(containerSeed[4]!.number)]!

  await seedCompletedTrip({
    reference: 'TRP-1001',
    containerId: yardContainerId,
    chassisId: chassisIds[0] ?? null,
    originId: portId,
    destinationId: yardId,
    pickedUpAt: daysAgo(1, 12, 5),
    droppedOffAt: daysAgo(1, 14, 40),
    isLoaded: true,
    isFinalRelease: false,
    customer: 'Coastal Tile Imports',
    notes: 'Gate 3 was backed up roughly 40 minutes.',
  })

  await seedCompletedTrip({
    reference: 'TRP-1002',
    containerId: loadingContainerId,
    chassisId: chassisIds[1] ?? null,
    originId: portId,
    destinationId: customerId,
    pickedUpAt: daysAgo(1, 9, 10),
    droppedOffAt: daysAgo(1, 11, 25),
    isLoaded: false,
    isFinalRelease: false,
    customer: 'Coastal Tile Imports',
  })

  await seedCompletedTrip({
    reference: 'TRP-1003',
    containerId: returnedContainerId,
    chassisId: chassisIds[2] ?? null,
    originId: portId,
    destinationId: customerId,
    pickedUpAt: daysAgo(3, 8, 15),
    droppedOffAt: daysAgo(3, 10, 40),
    isLoaded: false,
    isFinalRelease: false,
    customer: 'Coastal Tile Imports',
  })

  await seedCompletedTrip({
    reference: 'TRP-1004',
    containerId: returnedContainerId,
    chassisId: chassisIds[2] ?? null,
    originId: customerId,
    destinationId: railId,
    pickedUpAt: daysAgo(2, 13, 5),
    droppedOffAt: daysAgo(2, 15, 50),
    isLoaded: true,
    isFinalRelease: true,
    customer: 'Coastal Tile Imports',
  })

  /* ---- Timecards: three completed days + today's open tour ------- */
  const timecardSeed = [
    { offset: 3, start: 6, end: 16, minutes: 600 },
    { offset: 2, start: 6, end: 17, minutes: 660 },
    { offset: 1, start: 7, end: 16, minutes: 540 },
  ]

  let precedingMinutes = 0

  for (const seed of timecardSeed) {
    const start = daysAgo(seed.offset, seed.start, 30)
    const end = daysAgo(seed.offset, seed.end, 30)
    const workDate = isoDate(start)

    const [card] = await db
      .insert(driverTimecards)
      .values({
        companyId: company.id,
        driverId: driver.id,
        workDate,
        reportingLocationId: yardId,
        reportedForDutyAt: start,
        releasedFromDutyAt: end,
        totalOnDutyMinutes: seed.minutes,
        status: 'COMPLETED',
        shortHaulStatus: 'QUALIFIED',
        cycleType: 'SEVENTY_EIGHT',
        preceding7DayMinutes: precedingMinutes,
        completedAt: end,
        retainUntil: isoDate(new Date(start.getTime() + 190 * 24 * 60 * 60 * 1000)),
      })
      .onConflictDoUpdate({
        target: [driverTimecards.driverId, driverTimecards.workDate],
        set: { totalOnDutyMinutes: seed.minutes },
      })
      .returning({ id: driverTimecards.id })

    precedingMinutes += seed.minutes

    if (card) {
      await db
        .insert(timecardComplianceChecks)
        .values({
          companyId: company.id,
          timecardId: card.id,
          priorOffDutyMinutes: 14 * 60,
          maxRecordedAirMiles: 22.4,
          returnedToReportingLocation: true,
          releasedWithin14Hours: true,
          rollingCycleMinutes: precedingMinutes,
          radiusEvidenceLevel: 'RECORDED_LOCATIONS_ONLY',
        })
        .onConflictDoNothing()
    }
  }

  console.log('\nSeed complete.')
  console.log(`  Company      ${DEMO_COMPANY}  (invite code: ${INVITE_CODE})`)
  console.log(`  Admin        ${ADMIN_EMAIL} / ${PASSWORD}  → /admin/containers`)
  console.log(`  Driver       ${DRIVER_EMAIL} / ${PASSWORD}  → /`)
  console.log(`  Containers   ${containerSeed.length}`)
  console.log(`  Locations    ${locationSeed.length}`)

  await pool.end()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
