import { useMail } from './mail'

/**
 * Best-effort notice after a signed-in email change.
 *
 * Delivery failure must not roll back the update — the driver is already
 * authenticated and can correct a typo from Settings.
 */
export async function notifyEmailChanged(input: {
  firstName: string
  oldEmail: string
  newEmail: string
}): Promise<void> {
  const appName = String(useRuntimeConfig().public.appName || 'Gantry')
  const subject = `Your ${appName} email was updated`
  const text = [
    `Hi ${input.firstName},`,
    '',
    `The sign-in email for your ${appName} account is now ${input.newEmail}.`,
    `The previous address was ${input.oldEmail}.`,
    '',
    'If you did not make this change, contact your dispatcher immediately.',
  ].join('\n')

  try {
    const mail = useMail()
    await mail.send({ to: input.newEmail, subject, text })
    if (input.oldEmail.toLowerCase() !== input.newEmail.toLowerCase()) {
      await mail.send({ to: input.oldEmail, subject, text })
    }
  }
  catch (error) {
    console.error('[account] email-change notice failed', error)
  }
}
