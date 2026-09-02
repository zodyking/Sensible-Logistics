import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Database, DbExecutor } from '../utils/db'
import { chassis, containers, trips } from '../database/schema'
import { recordEvent } from './events'
import type { AuthContext } from '../utils/session'

const LIVE_TRIP_STATUSES = ['PICKUP_IN_PROGRESS', 'IN_TRANSIT', 'DROPOFF_IN_PROGRESS'] as const

export type ChassisLookup = {
  id: string
  number: string
  provider: string | null
  status: string
  outOfService: boolean
  sizeCompatibility: string | null
  currentContainerId: string | null
  currentContainerNumber: string | null
}

/** Attach the holder container's painted number when a chassis is already under a box. */
export async function withCurrentContainerNumber(
  db: DbExecutor,
  item: Omit<ChassisLookup, 'currentContainerNumber'>,
): Promise<ChassisLookup> {
  if (!item.currentContainerId) {
    return { ...item, currentContainerNumber: null }
  }

  const [box] = await db
    .select({
      number: containers.number,
      numberNormalized: containers.numberNormalized,
    })
    .from(containers)
    .where(eq(containers.id, item.currentContainerId))
    .limit(1)

  return {
    ...item,
    currentContainerNumber: box?.numberNormalized ?? box?.number ?? null,
  }
}

/**
 * Detach a chassis from the container it is sitting under so a driver can
 * use it on a new pickup. Live trips on that chassis are left alone.
 */
export async function releaseChassisHolder(
  db: Database,
  auth: AuthContext,
  chassisId: string,
): Promise<{ ok: true, item: ChassisLookup, releasedContainerId: string | null }> {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(chassis)
      .where(and(
        eq(chassis.id, chassisId),
        eq(chassis.companyId, auth.companyId),
        isNull(chassis.deletedAt),
      ))
      .limit(1)
      .for('update')

    if (!record) {
      throw createError({ statusCode: 404, statusMessage: 'Chassis not found.' })
    }
    if (record.outOfService) {
      throw createError({
        statusCode: 409,
        statusMessage: `Chassis ${record.number} is flagged out of service.`,
      })
    }

    const [live] = await tx
      .select({
        id: trips.id,
        reference: trips.reference,
      })
      .from(trips)
      .where(and(
        eq(trips.companyId, auth.companyId),
        eq(trips.chassisId, chassisId),
        inArray(trips.status, [...LIVE_TRIP_STATUSES]),
      ))
      .limit(1)

    if (live) {
      throw createError({
        statusCode: 409,
        statusMessage: 'That chassis is already on an active movement. Finish or cancel that trip first.',
        data: { tripId: live.id, reference: live.reference },
      })
    }

    const holderId = record.currentContainerId
    if (!holderId) {
      return {
        ok: true as const,
        item: await withCurrentContainerNumber(tx, {
          id: record.id,
          number: record.number,
          provider: record.provider,
          status: record.status,
          outOfService: record.outOfService,
          sizeCompatibility: record.sizeCompatibility,
          currentContainerId: null,
        }),
        releasedContainerId: null,
      }
    }

    const now = new Date()

    await tx
      .update(chassis)
      .set({
        currentContainerId: null,
        status: 'AVAILABLE',
        updatedAt: now,
      })
      .where(and(eq(chassis.id, chassisId), eq(chassis.companyId, auth.companyId)))

    const [holder] = await tx
      .select({ id: containers.id })
      .from(containers)
      .where(and(eq(containers.id, holderId), eq(containers.companyId, auth.companyId)))
      .limit(1)

    if (holder) {
      await recordEvent(
        tx,
        {
          id: crypto.randomUUID(),
          companyId: auth.companyId,
          containerId: holderId,
          eventType: 'CHASSIS_DETACH',
          actorUserId: auth.userId,
          actorDriverId: auth.driverId,
          chassisId,
          payload: { releasedChassisId: chassisId },
        },
        { currentChassisId: null },
      )
    }

    const [updated] = await tx
      .select({
        id: chassis.id,
        number: chassis.number,
        provider: chassis.provider,
        status: chassis.status,
        outOfService: chassis.outOfService,
        sizeCompatibility: chassis.sizeCompatibility,
        currentContainerId: chassis.currentContainerId,
      })
      .from(chassis)
      .where(eq(chassis.id, chassisId))
      .limit(1)

    return {
      ok: true as const,
      item: await withCurrentContainerNumber(tx, updated!),
      releasedContainerId: holderId,
    }
  })
}
