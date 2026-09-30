import { eq } from 'drizzle-orm'
import { containers, locations } from '../database/schema'
import { addContainerAtLocation, moveContainerToLocation } from './placements'
import { softDeleteContainer } from './container-delete'
import type { Database } from '../utils/db'
import type { AuthContext } from '../utils/session'
import { assertTenant } from '../utils/session'
import { LOCATION_AUDIT_MAX } from '#shared/utils/location-audit'
import type { ContainerType, EquipmentType } from '#shared/utils/domain'
import { formatContainerNumber, validateContainerNumber } from '#shared/utils/iso6346'

export type LocationAuditAction = 'add' | 'move' | 'delete'

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

export async function runLocationAudit(
  db: Database,
  auth: AuthContext,
  input: {
    locationId: string
    action: LocationAuditAction
    containerNumbers?: string[]
    containerType?: ContainerType
    equipmentType?: EquipmentType
    containerIds?: string[]
    destinationLocationId?: string
  },
): Promise<LocationAuditResult> {
  const location = await loadLocation(db, auth, input.locationId)
  const failed: LocationAuditFailure[] = []
  let succeeded = 0

  if (input.action === 'add') {
    const type = input.containerType
    const equipmentType = input.equipmentType
    if (!type || !equipmentType) {
      throw createError({ statusCode: 422, statusMessage: 'Choose container type and size.' })
    }
    const numbers = [...new Set((input.containerNumbers ?? []).map(value => value.trim()).filter(Boolean))]
      .slice(0, LOCATION_AUDIT_MAX)
    if (!numbers.length) {
      throw createError({ statusCode: 422, statusMessage: 'Paste at least one container number.' })
    }

    for (const raw of numbers) {
      const validation = validateContainerNumber(raw)
      if (!validation.structureValid || !validation.normalized) {
        failed.push({ number: raw, message: 'Not a container number.' })
        continue
      }
      try {
        await addContainerAtLocation(db, auth, {
          eventId: crypto.randomUUID(),
          locationId: location.id,
          containerNumber: validation.normalized,
          containerType: type,
          equipmentType,
          isLoaded: false,
        })
        succeeded += 1
      }
      catch (error) {
        failed.push({
          number: formatContainerNumber(validation.normalized) || validation.normalized,
          message: failureMessage(error, 'Could not add that container.'),
        })
      }
    }
  }
  else if (input.action === 'move') {
    const destinationId = input.destinationLocationId
    if (!destinationId) {
      throw createError({ statusCode: 422, statusMessage: 'Pick a destination.' })
    }
    if (destinationId === location.id) {
      throw createError({ statusCode: 422, statusMessage: 'Pick a different location.' })
    }
    await loadLocation(db, auth, destinationId)
    const ids = [...new Set(input.containerIds ?? [])].slice(0, LOCATION_AUDIT_MAX)
    if (!ids.length) {
      throw createError({ statusCode: 422, statusMessage: 'Select at least one container.' })
    }

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
        await softDeleteContainer(db, auth, containerId)
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
