import { z } from 'zod'
import { resetMail, useMail } from '../../services/mail'
import { requireAdmin } from '../../utils/session'

const schema = z.object({
  /** Defaults to the signed-in admin's own address. */
  to: z.string().trim().email('Enter a valid email address.').max(200).nullish(),
})

/**
 * Diagnose outbound mail without creating a driver account.
 *
 * Signup deliberately keeps its failure message vague for anonymous visitors, so
 * this is the endpoint that returns the provider's actual refusal — the SMTP
 * response code and text — to the operator who can fix it.
 */
export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event)
  const body = await readValidatedJson(event, schema)
  const to = body.to ?? auth.email

  // Environment changes only reach a new transporter, so a redeploy is not
  // needed to retest after fixing a variable.
  resetMail()
  const mail = useMail()

  const reachable = await mail.healthCheck()
  if (!reachable.healthy) {
    setResponseStatus(event, 502)
    return { ok: false, delivered: false, to, message: reachable.message }
  }

  const appName = String(useRuntimeConfig().public.appName || 'Gantry')

  try {
    await mail.send({
      to,
      subject: `${appName} SMTP test`,
      text: [
        'This is a test message from your driver portal.',
        '',
        'If you are reading it, outbound email is working and driver verification links will be delivered.',
      ].join('\n'),
      html: '<p>This is a test message from your driver portal.</p>'
        + '<p>If you are reading it, outbound email is working and driver verification links will be delivered.</p>',
    })
  }
  catch (error) {
    setResponseStatus(event, 502)
    return {
      ok: false,
      delivered: false,
      to,
      message: error instanceof Error ? error.message : String(error),
    }
  }

  return { ok: true, delivered: true, to, message: `Test email sent to ${to}. ${reachable.message}` }
})
