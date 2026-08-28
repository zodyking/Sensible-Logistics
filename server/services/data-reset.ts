import { and, count, eq, inArray, ne } from 'drizzle-orm'
import type { ResetCounts, ResetTargetId } from '../../shared/utils/reset-targets'
import {
  chassis,
  companyMemberships,
  containers,
  damageReports,
  dispatchTasks,
  documents,
  drivers,
  locations,
  ocrResults,
  trips,
  trucks,
  users,
} from '../database/schema'
import type { DbExecutor } from '../utils/db'

function n(value: unknown) {
  return Number(value ?? 0)
}

export async function loadResetCounts(db: DbExecutor, companyId: string, keepUserId: string): Promise<ResetCounts> {
  const [locationCount] = await db.select({ n: count() }).from(locations).where(eq(locations.companyId, companyId))
  const [containerCount] = await db.select({ n: count() }).from(containers).where(eq(containers.companyId, companyId))
  const [tripCount] = await db.select({ n: count() }).from(trips).where(eq(trips.companyId, companyId))
  const [chassisCount] = await db.select({ n: count() }).from(chassis).where(eq(chassis.companyId, companyId))
  const [documentCount] = await db.select({ n: count() }).from(documents).where(eq(documents.companyId, companyId))
  const [taskCount] = await db.select({ n: count() }).from(dispatchTasks).where(eq(dispatchTasks.companyId, companyId))
  const [truckCount] = await db.select({ n: count() }).from(trucks).where(eq(trucks.companyId, companyId))
  const [userCount] = await db
    .select({ n: count() })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, companyId), ne(companyMemberships.userId, keepUserId)))

  return {
    locations: n(locationCount?.n),
    containers: n(containerCount?.n),
    trips: n(tripCount?.n),
    chassis: n(chassisCount?.n),
    documents: n(documentCount?.n),
    tasks: n(taskCount?.n),
    trucks: n(truckCount?.n),
    users: n(userCount?.n),
  }
}

export async function clearResetTarget(
  db: DbExecutor,
  input: { companyId: string, keepUserId: string, target: ResetTargetId },
): Promise<{ deleted: number }> {
  const { companyId, keepUserId, target } = input

  return db.transaction(async (tx) => {
    if (target === 'locations') {
      await tx.update(containers).set({ currentLocationId: null }).where(eq(containers.companyId, companyId))
      await tx.update(chassis).set({ currentLocationId: null }).where(eq(chassis.companyId, companyId))
      await tx.update(trips).set({
        originLocationId: null,
        destinationLocationId: null,
      }).where(eq(trips.companyId, companyId))
      const rows = await tx.delete(locations).where(eq(locations.companyId, companyId)).returning({ id: locations.id })
      return { deleted: rows.length }
    }

    if (target === 'containers') {
      await tx.update(trips).set({ containerId: null }).where(eq(trips.companyId, companyId))
      await tx.update(chassis).set({ currentContainerId: null }).where(eq(chassis.companyId, companyId))
      await tx.delete(damageReports).where(eq(damageReports.companyId, companyId))
      const rows = await tx.delete(containers).where(eq(containers.companyId, companyId)).returning({ id: containers.id })
      return { deleted: rows.length }
    }

    if (target === 'trips') {
      await tx.update(containers).set({
        activeMovementId: null,
        currentDriverId: null,
      }).where(eq(containers.companyId, companyId))
      const rows = await tx.delete(trips).where(eq(trips.companyId, companyId)).returning({ id: trips.id })
      return { deleted: rows.length }
    }

    if (target === 'chassis') {
      await tx.update(trips).set({ chassisId: null }).where(eq(trips.companyId, companyId))
      await tx.update(containers).set({ currentChassisId: null }).where(eq(containers.companyId, companyId))
      const rows = await tx.delete(chassis).where(eq(chassis.companyId, companyId)).returning({ id: chassis.id })
      return { deleted: rows.length }
    }

    if (target === 'documents') {
      await tx.delete(ocrResults).where(eq(ocrResults.companyId, companyId))
      const rows = await tx.delete(documents).where(eq(documents.companyId, companyId)).returning({ id: documents.id })
      return { deleted: rows.length }
    }

    if (target === 'tasks') {
      const rows = await tx.delete(dispatchTasks).where(eq(dispatchTasks.companyId, companyId)).returning({ id: dispatchTasks.id })
      return { deleted: rows.length }
    }

    if (target === 'trucks') {
      await tx.update(trips).set({ truckId: null }).where(eq(trips.companyId, companyId))
      const rows = await tx.delete(trucks).where(eq(trucks.companyId, companyId)).returning({ id: trucks.id })
      return { deleted: rows.length }
    }

    const others = await tx
      .select({ userId: companyMemberships.userId })
      .from(companyMemberships)
      .where(and(eq(companyMemberships.companyId, companyId), ne(companyMemberships.userId, keepUserId)))
    const userIds = others.map(row => row.userId)
    if (!userIds.length) return { deleted: 0 }

    const otherDrivers = await tx
      .select({ id: drivers.id })
      .from(drivers)
      .where(and(eq(drivers.companyId, companyId), inArray(drivers.userId, userIds)))
    const driverIds = otherDrivers.map(row => row.id)
    if (driverIds.length) {
      await tx.delete(trips).where(and(eq(trips.companyId, companyId), inArray(trips.driverId, driverIds)))
      await tx.update(containers).set({ currentDriverId: null }).where(and(
        eq(containers.companyId, companyId),
        inArray(containers.currentDriverId, driverIds),
      ))
    }
    const rows = await tx.delete(users).where(inArray(users.id, userIds)).returning({ id: users.id })
    return { deleted: rows.length }
  })
}
