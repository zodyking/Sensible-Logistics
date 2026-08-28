import { z } from 'zod'
import { locations } from '../../database/schema'
import { findDuplicateCandidates, normalizeAddress } from '../../services/geocoding'
import { requireAuth } from '../../utils/session'
import { LOCATION_TYPES } from '#shared/utils/domain'
import { bboxFromPolygon, isValidBbox } from '#shared/utils/geo'
import { isValidPhone, toE164 } from '#shared/utils/phone'

const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
})

const usPhone = z.string().trim().max(40).nullish().refine(
  value => !value || isValidPhone(value),
  'Enter a 10-digit United States phone number.',
)

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
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  boundary: polygonSchema,
  capacity: z.coerce.number().int().min(0).max(100000).nullish(),
  hours: z.string().trim().max(200).nullish(),
  appointmentRequired: z.boolean().default(false),
  mainPhone: usPhone,
  contactName: z.string().trim().max(120).nullish(),
  contactPhone: usPhone,
  gateInstructions: z.string().trim().max(2000).nullish(),
  driverNotes: z.string().trim().max(2000).nullish(),
  acknowledgeDuplicates: z.boolean().default(false),
})

/** Create a location: name, type, address pin, and the OSM fence. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const body = await readValidatedJson(event, schema)
  const db = useDb()

  const normalizedAddress = normalizeAddress(body)
  const bbox = bboxFromPolygon(body.boundary)
  if (!bbox || !isValidBbox(bbox)) {
    throw createError({ statusCode: 422, statusMessage: 'Draw the location fence on the map.' })
  }

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

  const [location] = await db
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
      country: 'US',
      normalizedAddress,
      latitude: String(body.latitude),
      longitude: String(body.longitude),
      boundary: body.boundary,
      capacity: body.capacity ?? null,
      hours: body.hours ?? null,
      appointmentRequired: body.appointmentRequired,
      mainPhone: body.mainPhone ? toE164(body.mainPhone) : null,
      contactName: body.contactName ?? null,
      contactPhone: body.contactPhone ? toE164(body.contactPhone) : null,
      gateInstructions: body.gateInstructions ?? null,
      driverNotes: body.driverNotes ?? null,
      status: 'ACTIVE',
      createdByUserId: auth.userId,
    })
    .returning()

  if (!location) {
    throw createError({ statusCode: 500, statusMessage: 'Could not save the location.' })
  }

  return { ok: true, location }
})
