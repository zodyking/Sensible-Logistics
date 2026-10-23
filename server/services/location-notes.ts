import { and, desc, eq, gt } from 'drizzle-orm'
import { locationNotes, locations } from '../database/schema'
import type { Database } from '../utils/db'
import type { AuthContext } from '../utils/session'
import { assertTenant } from '../utils/session'
import {
  LOCATION_NOTE_BODY_MAX,
  LOCATION_NOTE_MAX,
  locationNoteAuthorName,
  locationNoteExpiresAt,
} from '#shared/utils/location-notes'

export type LocationNoteView = {
  id: string
  body: string
  authorName: string
  userId: string | null
  createdAt: Date
  expiresAt: Date
  mine: boolean
}

async function loadLocation(db: Database, auth: AuthContext, locationId: string) {
  const [location] = await db.select().from(locations).where(eq(locations.id, locationId)).limit(1)
  assertTenant(auth, location, 'Location')
  if (location!.deletedAt) {
    throw createError({ statusCode: 404, statusMessage: 'Location not found.' })
  }
  return location!
}

function toView(row: typeof locationNotes.$inferSelect, userId: string): LocationNoteView {
  return {
    id: row.id,
    body: row.body,
    authorName: row.authorName,
    userId: row.userId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    mine: row.userId === userId,
  }
}

export async function listLocationNotes(
  db: Database,
  auth: AuthContext,
  locationId: string,
): Promise<LocationNoteView[]> {
  await loadLocation(db, auth, locationId)
  const rows = await db
    .select()
    .from(locationNotes)
    .where(and(
      eq(locationNotes.companyId, auth.companyId),
      eq(locationNotes.locationId, locationId),
      gt(locationNotes.expiresAt, new Date()),
    ))
    .orderBy(desc(locationNotes.createdAt))
    .limit(LOCATION_NOTE_MAX)

  return rows.map(row => toView(row, auth.userId))
}

export async function createLocationNote(
  db: Database,
  auth: AuthContext,
  locationId: string,
  body: string,
): Promise<LocationNoteView> {
  const location = await loadLocation(db, auth, locationId)
  const text = body.trim()
  if (!text) {
    throw createError({ statusCode: 422, statusMessage: 'Write a note first.' })
  }
  if (text.length > LOCATION_NOTE_BODY_MAX) {
    throw createError({
      statusCode: 422,
      statusMessage: `Keep the note under ${LOCATION_NOTE_BODY_MAX} characters.`,
    })
  }

  const live = await listLocationNotes(db, auth, location.id)
  if (live.length >= LOCATION_NOTE_MAX) {
    throw createError({
      statusCode: 422,
      statusMessage: `This yard already has ${LOCATION_NOTE_MAX} notes.`,
    })
  }

  const now = new Date()
  const [created] = await db
    .insert(locationNotes)
    .values({
      companyId: auth.companyId,
      locationId: location.id,
      userId: auth.userId,
      authorName: locationNoteAuthorName(auth),
      body: text,
      createdAt: now,
      expiresAt: locationNoteExpiresAt(now),
    })
    .returning()

  if (!created) {
    throw createError({ statusCode: 500, statusMessage: 'Could not save the note.' })
  }
  return toView(created, auth.userId)
}

export async function deleteOwnLocationNote(
  db: Database,
  auth: AuthContext,
  locationId: string,
  noteId: string,
): Promise<void> {
  await loadLocation(db, auth, locationId)
  const [row] = await db
    .select()
    .from(locationNotes)
    .where(and(
      eq(locationNotes.id, noteId),
      eq(locationNotes.locationId, locationId),
      eq(locationNotes.companyId, auth.companyId),
    ))
    .limit(1)

  if (!row || row.expiresAt.getTime() <= Date.now()) {
    throw createError({ statusCode: 404, statusMessage: 'Note not found.' })
  }
  if (row.userId !== auth.userId) {
    throw createError({ statusCode: 403, statusMessage: 'You can only delete your own notes.' })
  }

  await db.delete(locationNotes).where(eq(locationNotes.id, noteId))
}
