import type { H3Event } from 'h3'
import { and, eq } from 'drizzle-orm'
import { drivers, trucks, users } from '../database/schema'
import { accountLockedError } from './account-lock'
import type { AuthContext } from './session'
import { normalizeVin } from '#shared/utils/time-card'

export interface AccountUser {
  id: string
  email: string
  passwordHash: string
  firstName: string
  lastName: string
  mobileNumber: string | null
}

/** Load the signed-in user row, or treat a missing/disabled account as signed out. */
export async function loadAccountUser(userId: string): Promise<AccountUser> {
  const db = useDb()
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      firstName: users.firstName,
      lastName: users.lastName,
      mobileNumber: users.mobileNumber,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Sign in required.' })
  }
  if (user.disabledAt) {
    throw accountLockedError()
  }

  return user
}

export type DriverEquipment = {
  cdlNumber: string
  cdlState: string
  truckVin: string
}

export async function loadDriverEquipment(
  userId: string,
  companyId: string,
  driverId: string | null,
): Promise<DriverEquipment | null> {
  if (!driverId) return null
  const db = useDb()
  const [row] = await db
    .select({
      cdlNumber: drivers.cdlNumber,
      cdlState: drivers.cdlState,
      vin: trucks.vin,
    })
    .from(drivers)
    .leftJoin(trucks, eq(trucks.id, drivers.preferredTruckId))
    .where(and(eq(drivers.id, driverId), eq(drivers.companyId, companyId), eq(drivers.userId, userId)))
    .limit(1)

  if (!row) return null
  return {
    cdlNumber: row.cdlNumber?.trim() || '',
    cdlState: row.cdlState?.trim() || '',
    truckVin: row.vin?.trim() || '',
  }
}

/** Point the driver at a company truck whose VIN matches, creating one if needed. */
export async function saveDriverPreferredVin(
  companyId: string,
  driverId: string,
  rawVin: string,
): Promise<string> {
  const vin = normalizeVin(rawVin)
  const db = useDb()
  const now = new Date()

  if (!vin) {
    await db.update(drivers).set({ preferredTruckId: null, updatedAt: now }).where(eq(drivers.id, driverId))
    return ''
  }

  const fleet = await db
    .select({ id: trucks.id, vin: trucks.vin, unitNumber: trucks.unitNumber })
    .from(trucks)
    .where(eq(trucks.companyId, companyId))

  let truckId = fleet.find(row => normalizeVin(row.vin) === vin)?.id
    ?? fleet.find(row => normalizeVin(row.unitNumber) === vin)?.id

  if (!truckId) {
    const [created] = await db
      .insert(trucks)
      .values({
        companyId,
        unitNumber: vin,
        vin,
        assignedDriverId: driverId,
        active: true,
      })
      .onConflictDoNothing({ target: [trucks.companyId, trucks.unitNumber] })
      .returning({ id: trucks.id })
    truckId = created?.id
  }

  if (!truckId) {
    const [existing] = await db
      .select({ id: trucks.id })
      .from(trucks)
      .where(and(eq(trucks.companyId, companyId), eq(trucks.unitNumber, vin)))
      .limit(1)
    truckId = existing?.id
  }

  if (!truckId) {
    throw createError({ statusCode: 422, statusMessage: 'Could not save that truck VIN.' })
  }

  await db.update(trucks).set({
    vin,
    assignedDriverId: driverId,
    updatedAt: now,
  }).where(eq(trucks.id, truckId))
  await db.update(drivers).set({ preferredTruckId: truckId, updatedAt: now }).where(eq(drivers.id, driverId))
  return vin
}

export async function assertCurrentPassword(passwordHash: string, password: string): Promise<void> {
  const valid = await verifyPassword(passwordHash, password)
  if (!valid) {
    throw createError({ statusCode: 403, statusMessage: 'Current password is incorrect.' })
  }
}

/**
 * Rewrite the public session fields after a profile change so More / Home
 * pick up the new name or email without a second sign-in.
 */
export async function refreshSessionUser(
  event: H3Event,
  auth: AuthContext,
  patch: Partial<Pick<AuthContext, 'email' | 'firstName' | 'lastName'>>,
): Promise<void> {
  const session = await getUserSession(event)
  const firstName = patch.firstName ?? auth.firstName
  const lastName = patch.lastName ?? auth.lastName

  await setUserSession(event, {
    user: {
      ...auth,
      ...patch,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`,
    },
    secure: session.secure,
    loggedInAt: session.loggedInAt ?? new Date().toISOString(),
  })
}
