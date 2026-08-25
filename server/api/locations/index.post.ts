import { z } from 'zod'
import { locationZones, locations, yardLayouts, yardObjects } from '../../database/schema'
import { findDuplicateCandidates, normalizeAddress } from '../../services/geocoding'
import { loadMapContext } from '../../services/osm-map'
import { requireAuth } from '../../utils/session'
import { LOCATION_TYPES } from '#shared/utils/domain'
import { bboxFromPolygon, isValidBbox } from '#shared/utils/geo'
import { toE164 } from '#shared/utils/phone'
import { generateYardModel } from '#shared/utils/yard-model'

const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
})

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
  boundary: polygonSchema.nullish(),
  capacity: z.coerce.number().int().min(0).max(100000).nullish(),
  hours: z.string().trim().max(200).nullish(),
  appointmentRequired: z.boolean().default(false),
  contactName: z.string().trim().max(120).nullish(),
  contactPhone: z.string().trim().max(40).nullish(),
  gateInstructions: z.string().trim().max(2000).nullish(),
  driverNotes: z.string().trim().max(2000).nullish(),
  acknowledgeDuplicates: z.boolean().default(false),
})

/**
 * Create a location in the shared pool, with an optional OSM-derived boundary
 * and a generated 2D yard model (slots, gate, office).
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const body = await readValidatedJson(event, schema)
  const db = useDb()

  const normalizedAddress = normalizeAddress(body)
  const bbox = body.boundary ? bboxFromPolygon(body.boundary) : null
  if (body.boundary && (!bbox || !isValidBbox(bbox))) {
    throw createError({ statusCode: 422, statusMessage: 'The location boundary is not a valid box.' })
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

  const mapContext = bbox ? await loadMapContext(bbox) : { ways: [], photo: null }

  const created = await db.transaction(async (tx) => {
    const [location] = await tx
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
        boundary: body.boundary ?? null,
        capacity: body.capacity ?? null,
        hours: body.hours ?? null,
        appointmentRequired: body.appointmentRequired,
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

    if (bbox) {
      const model = generateYardModel(bbox, body.capacity ?? 0, mapContext.ways)

      const [zone] = await tx
        .insert(locationZones)
        .values({
          companyId: auth.companyId,
          locationId: location.id,
          name: 'Yard',
          purpose: 'Generated from the drawn boundary',
          boundary: body.boundary ?? null,
          localGeometry: { planeWidth: model.planeWidth, planeHeight: model.planeHeight },
          capacity: body.capacity ?? model.placedSlots,
        })
        .returning({ id: locationZones.id })

      const [layout] = await tx
        .insert(yardLayouts)
        .values({
          companyId: auth.companyId,
          locationId: location.id,
          version: 1,
          name: `${body.name} layout`,
          isCurrent: true,
          planeWidth: model.planeWidth,
          planeHeight: model.planeHeight,
          geoTransform: {
            west: bbox.west,
            south: bbox.south,
            east: bbox.east,
            north: bbox.north,
          },
          createdByUserId: auth.userId,
        })
        .returning({ id: yardLayouts.id })

      if (layout && model.objects.length) {
        await tx.insert(yardObjects).values(model.objects.map(obj => ({
          companyId: auth.companyId,
          layoutId: layout.id,
          type: obj.type,
          label: obj.label,
          slotCode: obj.slotCode,
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          zoneId: zone?.id ?? null,
          style: obj.path ? { path: obj.path, kind: obj.kind ?? null } : null,
        })))
      }
    }

    return location
  })

  return { ok: true, location: created }
})
