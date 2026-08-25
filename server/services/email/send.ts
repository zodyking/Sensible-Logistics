import { useMail } from '../mail'
import { readEmailBrand } from './brand'
import { welcomeEmail } from './messages'

/**
 * Sent once, after a driver confirms their address. Delivery failure must not
 * undo verification — the account is already active.
 */
export async function sendWelcomeEmail(user: {
  email: string
  firstName: string
  companyName: string
}): Promise<void> {
  const brand = readEmailBrand()
  const portalUrl = brand.appUrl
  const rendered = welcomeEmail({
    brand,
    firstName: user.firstName,
    companyName: user.companyName,
    portalUrl,
  })

  await useMail().send({
    to: user.email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    attachments: rendered.attachments,
  })
}
