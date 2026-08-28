import { loadAccountUser } from '../../utils/account'

/**
 * Current driver's account fields for Settings.
 *
 * Phone lives only in the user row, not the session cookie, so this is the
 * source of truth after a number change.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const user = await loadAccountUser(auth.userId)

  return {
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    mobileNumber: user.mobileNumber,
    companyName: auth.companyName,
  }
})
