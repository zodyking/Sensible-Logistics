import { ACCOUNT_LOCKED_MESSAGE } from '#shared/utils/account-lock'

export function accountLockedError() {
  return createError({
    statusCode: 403,
    statusMessage: ACCOUNT_LOCKED_MESSAGE,
    data: { accountLocked: true },
  })
}
