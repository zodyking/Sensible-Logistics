import { deleteOwnLocationNote } from '../../../../services/location-notes'
import { requireAuth } from '../../../../utils/session'

/** Remove a note you left on this yard. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const locationId = getRouterParam(event, 'id')
  const noteId = getRouterParam(event, 'noteId')
  if (!locationId || !noteId) {
    throw createError({ statusCode: 400, statusMessage: 'Note id is required.' })
  }
  await deleteOwnLocationNote(useDb(), auth, locationId, noteId)
  return { ok: true }
})
