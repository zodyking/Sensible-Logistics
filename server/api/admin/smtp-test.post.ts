import { z } from 'zod'
import { readEmailBrand, smtpTestEmail } from '../../services/email'
import { appBaseUrl, resetMail, useMail } from '../../services/mail'
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

  let settingsUrl = ''
  try {
    settingsUrl = `${appBaseUrl()}/admin/settings`
  }
  catch {
    // Logo still inlines via CID when the public origin is not configured.
  }

  const rendered = smtpTestEmail({
    brand: readEmailBrand(),
    email: to,
    settingsUrl,
  })

  try {
    await mail.send({
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      attachments: rendered.attachments,
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
