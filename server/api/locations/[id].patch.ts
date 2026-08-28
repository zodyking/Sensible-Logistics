import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { locations } from '../../database/schema'
import { assertTenant, requireAuth } from '../../utils/session'
import { normalizeAddress } from '../../services/geocoding'
import { normalizeHeading } from '#shared/utils/geo'
import { LOCATION_TYPES } from '#shared/utils/domain'
import { isValidPhone, toE164 } from '#shared/utils/phone'

const usPhone = z.string().trim().max(40).nullish().refine(
  value => !value || isValidPhone(value),
  'Enter a 10-digit United States phone number.',
)

const schema = z.object({
  mapHeading: z.coerce.number().optional(),
  name: z.string().trim().min(1, 'Give the location a name.').max(160).optional(),
  type: z.enum(LOCATION_TYPES).optional(),
  addressLine1: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(120).nullish(),
  state: z.string().trim().max(60).nullish(),
  postalCode: z.string().trim().max(20).nullish(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  mainPhone: usPhone,
  contactName: z.string().trim().max(120).nullish(),
  contactPhone: usPhone,
}).refine(body => Object.values(body).some(value => value !== undefined), {
  message: 'Nothing to update.',
})

/** Update location details or the yard map heading. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }

  const body = await readValidatedJson(event, schema)
  const db = useDb()
  const [location] = await db.select().from(locations).where(eq(locations.id, id)).limit(1)
  assertTenant(auth, location, 'Location')
  if (location!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
  }
  if (location!.isUncategorized && (body.name || body.type)) {
    throw createError({ statusCode: 409, statusMessage: 'Uncategorized cannot be renamed.' })
  }

  const nextAddress = {
    addressLine1: body.addressLine1 ?? location!.addressLine1,
    city: body.city ?? location!.city,
    state: body.state ?? location!.state,
    postalCode: body.postalCode ?? location!.postalCode,
  }

  const [updated] = await db
    .update(locations)
    .set({
      ...(body.mapHeading != null ? { mapHeading: normalizeHeading(body.mapHeading) } : {}),
      ...(body.name ? { name: body.name } : {}),
      ...(body.type ? { type: body.type } : {}),
      ...(body.addressLine1 !== undefined ? { addressLine1: body.addressLine1 ?? null } : {}),
      ...(body.city !== undefined ? { city: body.city ?? null } : {}),
      ...(body.state !== undefined ? { state: body.state ?? null } : {}),
      ...(body.postalCode !== undefined ? { postalCode: body.postalCode ?? null } : {}),
      ...(body.latitude != null ? { latitude: String(body.latitude) } : {}),
      ...(body.longitude != null ? { longitude: String(body.longitude) } : {}),
      ...(body.mainPhone !== undefined ? { mainPhone: body.mainPhone ? toE164(body.mainPhone) : null } : {}),
      ...(body.contactName !== undefined ? { contactName: body.contactName ?? null } : {}),
      ...(body.contactPhone !== undefined ? { contactPhone: body.contactPhone ? toE164(body.contactPhone) : null } : {}),
      normalizedAddress: normalizeAddress(nextAddress),
      updatedAt: new Date(),
    })
    .where(eq(locations.id, id))
    .returning()

  return { ok: true, location: updated }
})
