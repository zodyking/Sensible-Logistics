import { z } from 'zod'
import { createLocationNote } from '../../../services/location-notes'
import { requireAuth } from '../../../utils/session'
import { LOCATION_NOTE_BODY_MAX } from '#shared/utils/location-notes'

const schema = z.object({
  body: z.string().trim().min(1, 'Write a note first.').max(LOCATION_NOTE_BODY_MAX),
})

/** Leave a yard note. It expires one month after it is saved. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const locationId = getRouterParam(event, 'id')
  if (!locationId) {
    throw createError({ statusCode: 400, statusMessage: 'Location id is required.' })
  }
  const body = await readValidatedJson(event, schema)
  const note = await createLocationNote(useDb(), auth, locationId, body.body)
  return { note }
})
