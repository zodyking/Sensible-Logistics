import { z } from 'zod'
import { locations } from '../../database/schema'
import { findDuplicateCandidates, normalizeAddress } from '../../services/geocoding'
import { requireAuth } from '../../utils/session'
import { LOCATION_TYPES } from '#shared/utils/domain'
import { toE164 } from '#shared/utils/phone'

const schema = z.object({
  name: z.string().trim().min(1, 'Give the location a name.').max(160),
  type: z.enum(LOCATION_TYPES),
  locationCode: z.string().trim().max(40).nullish(),
  addressLine1: z.string().trim().max(200).nullish(),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(120).nullish(),
  state: z.string().trim().max(60).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  country: z.string().trim().max(2).default('US'),
  latitude: z.coerce.number().min(-90).max(90).nullish(),
  longitude: z.coerce.number().min(-180).max(180).nullish(),
  capacity: z.coerce.number().int().min(0).max(100000).nullish(),
  hours: z.string().trim().max(200).nullish(),
  appointmentRequired: z.boolean().default(false),
  contactName: z.string().trim().max(120).nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
  gateInstructions: z.string().trim().max(2000).nullish(),
  driverNotes: z.string().trim().max(2000).nullish(),
  /** Set true to save despite duplicate suggestions. */
  acknowledgeDuplicates: z.boolean().default(false),
})

/**
 * Create a location in the shared pool.
 *
 * Duplicate prevention runs first (spec 7.1): normalised address, name and
 * proximity are compared and returned as suggestions before a second yard or
 * customer record is allowed.
 *
 * TODO(Phase 2): geocode via self-hosted Nominatim and capture the operational
 * boundary polygon with MapLibre + Terra Draw.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const body = await readValidatedJson(event, schema)
  const db = useDb()

  const normalizedAddress = normalizeAddress(body)

  if (!body.acknowledgeDuplicates) {
    const duplicates = await findDuplicateCandidates(db, auth.companyId, {
      name: body.name,
      normalizedAddress,
      latitude: body.latitude,
      longitude: body.longitude,
    })

    if (duplicates.length > 0) {
      setResponseStatus(event, 409)
      return { ok: false, duplicates, message: 'This may already exist in the location pool.' }
    }
  }

  const [created] = await db
    .insert(locations)
    .values({
      companyId: auth.companyId,
      name: body.name,
      type: body.type,
      locationCode: body.locationCode ?? null,
      addressLine1: body.addressLine1 ?? null,
      addressLine2: body.addressLine2 ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      postalCode: body.postalCode ?? null,
      country: body.country,
      normalizedAddress,
      latitude: body.latitude != null ? String(body.latitude) : null,
      longitude: body.longitude != null ? String(body.longitude) : null,
      capacity: body.capacity ?? null,
      hours: body.hours ?? null,
      appointmentRequired: body.appointmentRequired,
      contactName: body.contactName ?? null,
      // Site contacts are sometimes switchboards or extensions, so anything that
      // is not a plain 10-digit number is stored as entered.
      contactPhone: body.contactPhone ? toE164(body.contactPhone) : null,
      gateInstructions: body.gateInstructions ?? null,
      driverNotes: body.driverNotes ?? null,
      status: 'ACTIVE',
      createdByUserId: auth.userId,
    })
    .returning()

  return { ok: true, location: created }
})
