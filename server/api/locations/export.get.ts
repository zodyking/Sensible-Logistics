import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { locations } from '../../database/schema'
import { requireAuth } from '../../utils/session'
import { formatLocationDirectoryCsv, locationCsvFileName } from '#shared/utils/location-csv'

const EXPORT_MAX = 2000

const querySchema = z.object({
  id: z.string().uuid().optional(),
})

/** Company location directory as a spreadsheet: name, type, address, and contacts. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)
  const db = useDb()

  const filters = [
    eq(locations.companyId, auth.companyId),
    isNull(locations.deletedAt),
    eq(locations.isUncategorized, false),
  ]
  if (query.id) filters.push(eq(locations.id, query.id))

  const rows = await db
    .select({
      name: locations.name,
      type: locations.type,
      locationCode: locations.locationCode,
      addressLine1: locations.addressLine1,
      addressLine2: locations.addressLine2,
      city: locations.city,
      state: locations.state,
      postalCode: locations.postalCode,
      country: locations.country,
      mainPhone: locations.mainPhone,
      contactName: locations.contactName,
      contactPhone: locations.contactPhone,
      hours: locations.hours,
      appointmentRequired: locations.appointmentRequired,
      status: locations.status,
      gateInstructions: locations.gateInstructions,
      driverNotes: locations.driverNotes,
      shipcsxTerminal: locations.shipcsxTerminal,
      capacity: locations.capacity,
    })
    .from(locations)
    .where(and(...filters))
    .orderBy(asc(locations.name))
    .limit(EXPORT_MAX)

  if (query.id && !rows.length) {
    throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
  }

  const csv = formatLocationDirectoryCsv(rows)
  const fileName = locationCsvFileName()
  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="${fileName}"`)
  return csv
})
