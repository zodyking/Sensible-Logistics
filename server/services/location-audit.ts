import { eq } from 'drizzle-orm'
import { chassis, containers, locations } from '../database/schema'
import { addChassisAtLocation, addContainerAtLocation, moveContainerToLocation } from './placements'
import { retireContainer } from './container-delete'
import { retireChassis } from './chassis-delete'
import { ensureUncategorizedLocation } from './locations'
import type { Database } from '../utils/db'
import type { AuthContext } from '../utils/session'
import { assertTenant } from '../utils/session'
import { LOCATION_AUDIT_MAX } from '#shared/utils/location-audit'
import type { LocationAuditAddItem } from '#shared/utils/location-audit'
import { isCompleteChassisNumber, validateContainerNumber } from '#shared/utils/iso6346'

export type LocationAuditAction = 'add' | 'move' | 'delete' | 'check'

export type LocationAuditFailure = {
  id?: string
  number?: string
  message: string
}

export type LocationAuditResult = {
  action: LocationAuditAction
  succeeded: number
  failed: LocationAuditFailure[]
}

function failureMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'statusMessage' in error) {
    const message = (error as { statusMessage?: unknown }).statusMessage
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

async function loadLocation(db: Database, auth: AuthContext, locationId: string) {
  const [location] = await db.select().from(locations).where(eq(locations.id, locationId)).limit(1)
  assertTenant(auth, location, 'Location')
  if (location!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
  }
  return location!
}

async function addAuditItem(
  db: Database,
  auth: AuthContext,
  locationId: string,
  item: LocationAuditAddItem,
): Promise<void> {
  if (item.kind === 'BARE_CHASSIS') {
    if (!isCompleteChassisNumber(item.chassisNumber)) {
      throw createError({ statusCode: 422, statusMessage: 'A chassis number is four letters then six digits.' })
    }
    await addChassisAtLocation(db, auth, {
      eventId: crypto.randomUUID(),
      locationId,
      chassisNumber: item.chassisNumber,
    })
    return
  }

  const validation = validateContainerNumber(item.containerNumber)
  if (!validation.structureValid || !validation.normalized) {
    throw createError({ statusCode: 422, statusMessage: 'Not a container number.' })
  }
  await addContainerAtLocation(db, auth, {
    eventId: crypto.randomUUID(),
    locationId,
    containerNumber: validation.normalized,
    containerType: item.containerType,
    equipmentType: item.equipmentType,
    isLoaded: false,
    chassisNumber: item.chassisNumber?.trim() || null,
  })
}

async function pullFromUncategorized(
  db: Database,
  auth: AuthContext,
  destinationId: string,
  input: {
    containerIds?: string[]
    chassisIds?: string[]
  },
  failed: LocationAuditFailure[],
): Promise<number> {
  const hold = await ensureUncategorizedLocation(db, auth.companyId)
  if (hold.id === destinationId) {
    throw createError({ statusCode: 422, statusMessage: 'That equipment is already in Uncategorized.' })
  }

  let succeeded = 0
  const containerIds = [...new Set(input.containerIds ?? [])]
  const chassisIds = [...new Set(input.chassisIds ?? [])]

  for (const containerId of containerIds) {
    const [row] = await db.select().from(containers).where(eq(containers.id, containerId)).limit(1)
    const number = row?.number
    try {
      assertTenant(auth, row, 'Container')
      if (row!.deletedAt) {
        throw createError({ statusCode: 404, statusMessage: 'Container not found.' })
      }
      if (row!.currentLocationId !== hold.id) {
        throw createError({
          statusCode: 409,
          statusMessage: 'That container is not in Uncategorized.',
        })
      }
      await moveContainerToLocation(db, auth, {
        eventId: crypto.randomUUID(),
        containerId,
        destinationLocationId: destinationId,
      })
      succeeded += 1
    }
    catch (error) {
      failed.push({
        id: containerId,
        number,
        message: failureMessage(error, 'Could not add that container.'),
      })
    }
  }

  for (const chassisId of chassisIds) {
    const [row] = await db.select().from(chassis).where(eq(chassis.id, chassisId)).limit(1)
    const number = row?.number
    try {
      assertTenant(auth, row, 'Chassis')
      if (row!.deletedAt) {
        throw createError({ statusCode: 404, statusMessage: 'Chassis not found.' })
      }
      if (row!.currentLocationId !== hold.id) {
        throw createError({
          statusCode: 409,
          statusMessage: 'That chassis is not in Uncategorized.',
        })
      }
      await addChassisAtLocation(db, auth, {
        eventId: crypto.randomUUID(),
        locationId: destinationId,
        chassisNumber: row!.number,
      })
      succeeded += 1
    }
    catch (error) {
      failed.push({
        id: chassisId,
        number,
        message: failureMessage(error, 'Could not add that chassis.'),
      })
    }
  }

  return succeeded
}

export async function runLocationAudit(
  db: Database,
  auth: AuthContext,
  input: {
    locationId: string
    action: LocationAuditAction
    items?: LocationAuditAddItem[]
    uncategorizedContainerIds?: string[]
    uncategorizedChassisIds?: string[]
    containerIds?: string[]
    chassisIds?: string[]
    destinationLocationId?: string
  },
): Promise<LocationAuditResult> {
  const location = await loadLocation(db, auth, input.locationId)
  const failed: LocationAuditFailure[] = []
  let succeeded = 0

  if (input.action === 'add') {
    const items = (input.items ?? []).slice(0, LOCATION_AUDIT_MAX)
    if (!items.length) {
      throw createError({ statusCode: 422, statusMessage: 'Add at least one container or chassis.' })
    }

    for (const item of items) {
      const fallbackNumber = item.kind === 'BARE_CHASSIS' ? item.chassisNumber : item.containerNumber
      try {
        await addAuditItem(db, auth, location.id, item)
        succeeded += 1
      }
      catch (error) {
        failed.push({
          number: fallbackNumber,
          message: failureMessage(error, 'Could not add that equipment.'),
        })
      }
    }
  }
  else if (input.action === 'move') {
    const holdBoxes = [...new Set(input.uncategorizedContainerIds ?? [])]
    const holdChassis = [...new Set(input.uncategorizedChassisIds ?? [])]
    const ids = [...new Set(input.containerIds ?? [])].slice(0, LOCATION_AUDIT_MAX)
    const destinationId = input.destinationLocationId

    if (!ids.length && !holdBoxes.length && !holdChassis.length) {
      throw createError({ statusCode: 422, statusMessage: 'Select at least one container or chassis.' })
    }

    if (ids.length) {
      if (!destinationId) {
        throw createError({ statusCode: 422, statusMessage: 'Pick a destination.' })
      }
      if (destinationId === location.id) {
        throw createError({ statusCode: 422, statusMessage: 'Pick a different location.' })
      }
      await loadLocation(db, auth, destinationId)

      for (const containerId of ids) {
        const [row] = await db.select().from(containers).where(eq(containers.id, containerId)).limit(1)
        const number = row?.number
        try {
          assertTenant(auth, row, 'Container')
          if (row!.deletedAt) {
            throw createError({ statusCode: 404, statusMessage: 'Container not found.' })
          }
          if (row!.currentLocationId !== location.id) {
            throw createError({
              statusCode: 409,
              statusMessage: 'That container is not at this location.',
            })
          }
          await moveContainerToLocation(db, auth, {
            eventId: crypto.randomUUID(),
            containerId,
            destinationLocationId: destinationId,
          })
          succeeded += 1
        }
        catch (error) {
          failed.push({
            id: containerId,
            number,
            message: failureMessage(error, 'Could not move that container.'),
          })
        }
      }
    }

    succeeded += await pullFromUncategorized(
      db,
      auth,
      location.id,
      { containerIds: holdBoxes, chassisIds: holdChassis },
      failed,
    )
  }
  else if (input.action === 'check') {
    if (location.isUncategorized) {
      throw createError({ statusCode: 422, statusMessage: 'Checklist is for yards with live inventory.' })
    }
    const boxIds = [...new Set(input.containerIds ?? [])]
    const unitIds = [...new Set(input.chassisIds ?? [])]
    if (!boxIds.length && !unitIds.length) {
      throw createError({ statusCode: 422, statusMessage: 'Uncheck at least one unit that is not here.' })
    }

    for (const containerId of boxIds) {
      const [row] = await db.select().from(containers).where(eq(containers.id, containerId)).limit(1)
      const number = row?.number
      try {
        assertTenant(auth, row, 'Container')
        if (row!.currentLocationId !== location.id) {
          throw createError({
            statusCode: 409,
            statusMessage: 'That container is not at this location.',
          })
        }
        await retireContainer(db, auth, containerId)
        succeeded += 1
      }
      catch (error) {
        failed.push({
          id: containerId,
          number,
          message: failureMessage(error, 'Could not move that container.'),
        })
      }
    }

    for (const chassisId of unitIds) {
      const [row] = await db.select().from(chassis).where(eq(chassis.id, chassisId)).limit(1)
      const number = row?.number
      try {
        assertTenant(auth, row, 'Chassis')
        if (row!.currentLocationId !== location.id) {
          throw createError({
            statusCode: 409,
            statusMessage: 'That chassis is not at this location.',
          })
        }
        await retireChassis(db, auth, chassisId)
        succeeded += 1
      }
      catch (error) {
        failed.push({
          id: chassisId,
          number,
          message: failureMessage(error, 'Could not move that chassis.'),
        })
      }
    }
  }
  else {
    const ids = [...new Set(input.containerIds ?? [])].slice(0, LOCATION_AUDIT_MAX)
    if (!ids.length) {
      throw createError({ statusCode: 422, statusMessage: 'Select at least one container.' })
    }

    for (const containerId of ids) {
      const [row] = await db.select().from(containers).where(eq(containers.id, containerId)).limit(1)
      const number = row?.number
      try {
        assertTenant(auth, row, 'Container')
        if (row!.currentLocationId !== location.id) {
          throw createError({
            statusCode: 409,
            statusMessage: 'That container is not at this location.',
          })
        }
        await retireContainer(db, auth, containerId)
        succeeded += 1
      }
      catch (error) {
        failed.push({
          id: containerId,
          number,
          message: failureMessage(error, 'Could not delete that container.'),
        })
      }
    }
  }

  return { action: input.action, succeeded, failed }
}
