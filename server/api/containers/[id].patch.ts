import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { chassis, containers, trips } from '../../database/schema'
import { recordEvent } from '../../services/events'
import { LIVE_TRIP_STATUSES } from '../../services/movements'
import { assertTenant, requireAuth } from '../../utils/session'
import { CONTAINER_TYPES, EQUIPMENT_TYPES } from '#shared/utils/domain'
import {
  formatContainerNumber,
  isCompleteChassisNumber,
  normalizeChassisNumber,
  normalizeContainerNumber,
  validateContainerNumber,
} from '#shared/utils/iso6346'

const schema = z.object({
  eventId: z.string().uuid().optional(),
  number: z.string().trim().min(1).max(40).optional(),
  containerType: z.enum(CONTAINER_TYPES).optional(),
  equipmentType: z.enum(EQUIPMENT_TYPES).optional(),
  chassisNumber: z.string().trim().max(40).nullish(),
  isLoaded: z.boolean().optional(),
  sealNumber: z.string().trim().max(60).nullish(),
}).refine(body => Object.keys(body).some(key => key !== 'eventId' && body[key as keyof typeof body] !== undefined), {
  message: 'Nothing to update.',
})

/** Edit a parked container: number, type, size, chassis, loaded/empty, and seal. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Container id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  const db = useDb()
  const [container] = await db.select().from(containers).where(eq(containers.id, id)).limit(1)
  assertTenant(auth, container, 'Container')
  if (container!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Container not found.' })
  }

  const [live] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(
      eq(trips.companyId, auth.companyId),
      eq(trips.containerId, id),
      inArray(trips.status, [...LIVE_TRIP_STATUSES]),
    ))
    .limit(1)
  if (live) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Finish or cancel the active trip before editing this container.',
    })
  }

  let number = container!.number
  let numberNormalized = container!.numberNormalized
  let checkDigitValid = container!.checkDigitValid
  if (body.number) {
    const validation = validateContainerNumber(body.number)
    if (!validation.structureValid) {
      throw createError({ statusCode: 422, statusMessage: validation.errors[0] ?? 'Enter a valid container number.' })
    }
    numberNormalized = normalizeContainerNumber(body.number)
    number = formatContainerNumber(numberNormalized) || numberNormalized
    checkDigitValid = validation.valid
    const [taken] = await db
      .select({ id: containers.id })
      .from(containers)
      .where(and(
        eq(containers.companyId, auth.companyId),
        eq(containers.numberNormalized, numberNormalized),
        isNull(containers.deletedAt),
      ))
      .limit(1)
    if (taken && taken.id !== id) {
      throw createError({ statusCode: 409, statusMessage: 'That container number is already in the pool.' })
    }
  }

  const isLoaded = body.isLoaded ?? container!.isLoaded
  const sealNumber = isLoaded
    ? (body.sealNumber !== undefined ? (body.sealNumber?.trim() || null) : container!.sealNumber)
    : null
  if (body.isLoaded === true && !sealNumber) {
    throw createError({ statusCode: 422, statusMessage: 'Enter a seal number for a loaded container.' })
  }

  let nextChassisId = container!.currentChassisId
  if (body.chassisNumber !== undefined) {
    const typed = (body.chassisNumber ?? '').trim()
    if (!typed) {
      nextChassisId = null
    }
    else {
      if (!isCompleteChassisNumber(typed)) {
        throw createError({ statusCode: 422, statusMessage: 'A chassis number is four letters then six digits.' })
      }
      const numberNormalizedChassis = normalizeChassisNumber(typed)
      const [existing] = await db
        .select()
        .from(chassis)
        .where(and(
          eq(chassis.companyId, auth.companyId),
          eq(chassis.numberNormalized, numberNormalizedChassis),
          isNull(chassis.deletedAt),
        ))
        .limit(1)
      if (existing) {
        if (existing.outOfService) {
          throw createError({ statusCode: 409, statusMessage: `Chassis ${existing.number} is flagged out of service.` })
        }
        if (existing.currentContainerId && existing.currentContainerId !== id) {
          throw createError({ statusCode: 409, statusMessage: 'That chassis is already under another container.' })
        }
        nextChassisId = existing.id
      }
      else {
        const [created] = await db
          .insert(chassis)
          .values({
            companyId: auth.companyId,
            number: numberNormalizedChassis,
            numberNormalized: numberNormalizedChassis,
            status: 'AVAILABLE',
            currentLocationId: container!.currentLocationId,
          })
          .returning({ id: chassis.id })
        nextChassisId = created!.id
      }
    }
  }

  const now = new Date()
  await db.transaction(async (tx) => {
    if (container!.currentChassisId && container!.currentChassisId !== nextChassisId) {
      await tx
        .update(chassis)
        .set({ currentContainerId: null, status: 'AVAILABLE', updatedAt: now })
        .where(and(eq(chassis.id, container!.currentChassisId), eq(chassis.companyId, auth.companyId)))
    }

    await recordEvent(
      tx,
      {
        id: body.eventId ?? crypto.randomUUID(),
        companyId: auth.companyId,
        containerId: id,
        eventType: 'CORRECTION',
        actorUserId: auth.userId,
        actorDriverId: auth.driverId,
        locationId: container!.currentLocationId,
        chassisId: nextChassisId,
        payload: {
          number,
          containerType: body.containerType ?? container!.containerType,
          equipmentType: body.equipmentType ?? container!.equipmentType,
          isLoaded,
          sealNumber,
          chassisId: nextChassisId,
        },
        notes: 'Container record edited.',
      },
      {
        isLoaded,
        sealNumber,
        currentChassisId: nextChassisId,
      },
    )

    await tx
      .update(containers)
      .set({
        number,
        numberNormalized,
        checkDigitValid,
        containerType: body.containerType ?? container!.containerType,
        equipmentType: body.equipmentType ?? container!.equipmentType,
        updatedAt: now,
      })
      .where(eq(containers.id, id))

    if (nextChassisId) {
      await tx
        .update(chassis)
        .set({
          currentContainerId: id,
          currentLocationId: container!.currentLocationId,
          status: 'AVAILABLE',
          updatedAt: now,
        })
        .where(and(eq(chassis.id, nextChassisId), eq(chassis.companyId, auth.companyId)))
    }
  })

  const [updated] = await db.select().from(containers).where(eq(containers.id, id)).limit(1)
  const [currentChassis] = updated!.currentChassisId
    ? await db.select().from(chassis).where(eq(chassis.id, updated!.currentChassisId)).limit(1)
    : []

  return { ok: true, container: updated, currentChassis: currentChassis ?? null }
})
