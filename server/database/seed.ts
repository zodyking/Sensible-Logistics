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
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { computeCheckDigit, normalizeContainerNumber, validateContainerNumber } from '../../shared/utils/iso6346'
import * as schema from './schema'

const {
  chassis,
  companies,
  companyMemberships,
  containerEvents,
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

  const [admin] = await db
    .insert(users)
    .values({
      email: ADMIN_EMAIL,
      passwordHash,
      firstName: 'Dana',
      lastName: 'Reyes',
      mobileNumber: '+19545550142',
      emailVerifiedAt: verifiedAt,
    })
    .onConflictDoUpdate({ target: users.email, set: { passwordHash, emailVerifiedAt: verifiedAt } })
    .returning()

  const [driverUser] = await db
    .insert(users)
    .values({
      email: DRIVER_EMAIL,
      passwordHash,
      firstName: 'Marcus',
      lastName: 'Vega',
      mobileNumber: '+19545550187',
      emailVerifiedAt: verifiedAt,
    })
    .onConflictDoUpdate({ target: users.email, set: { passwordHash, emailVerifiedAt: verifiedAt } })
    .returning()

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
      latitude: '26.0930000',
      longitude: '-80.1180000',
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
      latitude: '26.0680000',
      longitude: '-80.2470000',
      capacity: 240,
      appointmentRequired: false,
      hours: 'Open 24 hours',
    },
    {
      name: 'Medley Distribution Center',
      type: 'WAREHOUSE' as const,
      addressLine1: '9200 NW 105th Way',
      city: 'Medley',
      state: 'FL',
      postalCode: '33178',
      latitude: '25.8620000',
      longitude: '-80.3400000',
      capacity: 60,
      appointmentRequired: true,
      hours: 'Mon–Sat 07:00–19:00',
    },
    {
      name: 'Hialeah Empty Depot',
      type: 'DEPOT' as const,
      addressLine1: '3050 E 11th Avenue',
      city: 'Hialeah',
      state: 'FL',
      postalCode: '33013',
      latitude: '25.8460000',
      longitude: '-80.2800000',
      capacity: 400,
      appointmentRequired: false,
      hours: 'Mon–Fri 07:00–16:00',
    },
  ]

  const locationIds: Record<string, string> = {}

  for (const seed of locationSeed) {
    const existing = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.companyId, company.id), eq(locations.name, seed.name)))
      .limit(1)

    if (existing[0]) {
      locationIds[seed.name] = existing[0].id
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
        latitude: seed.latitude,
        longitude: seed.longitude,
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
  const warehouseId = locationIds['Medley Distribution Center']!
  const depotId = locationIds['Hialeah Empty Depot']!

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
    'containerType' | 'equipmentType' | 'isLoaded' | 'activePoolState' | 'currentLocationId'
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
      activePoolState: 'AT_LOCATION' as const,
      currentLocationId: depotId,
      steamshipLine: 'CMA CGM',
    },
    {
      number: containerNumber('CAIU', '298455'),
      containerType: 'TROPICAL' as const,
      equipmentType: 'REEFER' as const,
      isLoaded: true,
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
      isLoaded: true,
      activePoolState: 'AT_LOCATION' as const,
      currentLocationId: warehouseId,
      steamshipLine: 'CMA CGM',
      commodity: 'Packaged goods',
      customerReference: 'PO-44812',
    },
    {
      number: containerNumber('KOCU', '610233'),
      containerType: 'KING_OCEAN' as const,
      equipmentType: 'DRY_20' as const,
      isLoaded: true,
      activePoolState: 'INACTIVE' as const,
      currentLocationId: null,
      steamshipLine: 'King Ocean',
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
        set: { lastActivityAt: daysAgo(1, 14) },
      })
      .returning({ id: containers.id })

    if (row) containerIds[normalized] = row.id
  }

  /* ---- One completed trip with its event timeline ---------------- */
  const tripContainerId = containerIds[normalizeContainerNumber(containerSeed[0]!.number)]!
  const existingTrip = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.companyId, company.id), eq(trips.reference, 'TRP-1001')))
    .limit(1)

  if (!existingTrip[0]) {
    const pickedUpAt = daysAgo(1, 12, 5)
    const droppedOffAt = daysAgo(1, 14, 40)

    const [trip] = await db
      .insert(trips)
      .values({
        companyId: company.id,
        reference: 'TRP-1001',
        driverId: driver.id,
        containerId: tripContainerId,
        chassisId: chassisIds[0] ?? null,
        originLocationId: portId,
        destinationLocationId: yardId,
        status: 'COMPLETED',
        isLoaded: true,
        sealNumber: 'SL-778213',
        customer: 'Coastal Tile Imports',
        steamshipLine: 'ZIM',
        pickedUpAt,
        droppedOffAt,
        completedAt: droppedOffAt,
        driverNotes: 'Gate 3 was backed up roughly 40 minutes.',
      })
      .returning()

    if (trip) {
      await db.insert(containerEvents).values([
        {
          id: randomUUID(),
          companyId: company.id,
          containerId: tripContainerId,
          eventType: 'PICKUP_STARTED',
          occurredAt: daysAgo(1, 11, 48),
          actorUserId: driverUser.id,
          actorDriverId: driver.id,
          source: 'MANUAL',
          tripId: trip.id,
          locationId: portId,
          payload: { previousState: 'INACTIVE', nextState: 'PICKUP_IN_PROGRESS' },
        },
        {
          id: randomUUID(),
          companyId: company.id,
          containerId: tripContainerId,
          eventType: 'PICKUP_CONFIRMED',
          occurredAt: pickedUpAt,
          actorUserId: driverUser.id,
          actorDriverId: driver.id,
          source: 'MANUAL',
          tripId: trip.id,
          locationId: portId,
          chassisId: chassisIds[0] ?? null,
          payload: { previousState: 'PICKUP_IN_PROGRESS', nextState: 'DRIVER_CUSTODY', sealNumber: 'SL-778213' },
        },
        {
          id: randomUUID(),
          companyId: company.id,
          containerId: tripContainerId,
          eventType: 'DEPARTED',
          occurredAt: daysAgo(1, 12, 20),
          actorDriverId: driver.id,
          source: 'MANUAL',
          tripId: trip.id,
          locationId: portId,
          payload: {},
        },
        {
          id: randomUUID(),
          companyId: company.id,
          containerId: tripContainerId,
          eventType: 'ARRIVED',
          occurredAt: daysAgo(1, 14, 25),
          actorDriverId: driver.id,
          source: 'MANUAL',
          tripId: trip.id,
          locationId: yardId,
          payload: {},
        },
        {
          id: randomUUID(),
          companyId: company.id,
          containerId: tripContainerId,
          eventType: 'DROPOFF_CONFIRMED',
          occurredAt: droppedOffAt,
          actorUserId: driverUser.id,
          actorDriverId: driver.id,
          source: 'MANUAL',
          tripId: trip.id,
          locationId: yardId,
          payload: { previousState: 'DRIVER_CUSTODY', nextState: 'AT_LOCATION' },
        },
      ])
    }
  }

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
