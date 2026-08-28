import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { users } from '../../database/schema'
import { loadAccountUser, refreshSessionUser } from '../../utils/account'

const schema = z.object({
  firstName: z.string().trim().min(1, 'First name is required.').max(80),
  lastName: z.string().trim().min(1, 'Last name is required.').max(80),
})

/** Updates the legal name shown on More, Home, and trip history. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const body = await readValidatedJson(event, schema)
  await loadAccountUser(auth.userId)

  const now = new Date()
  const db = useDb()

  await db
    .update(users)
    .set({
      firstName: body.firstName,
      lastName: body.lastName,
      updatedAt: now,
    })
    .where(eq(users.id, auth.userId))

  await refreshSessionUser(event, auth, {
    firstName: body.firstName,
    lastName: body.lastName,
  })

  return {
    ok: true,
    firstName: body.firstName,
    lastName: body.lastName,
    fullName: `${body.firstName} ${body.lastName}`,
  }
})
