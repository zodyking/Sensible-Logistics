import type { EmailBrand } from './brand'
import { formatUtcStamp } from './escape'
import { renderLayout, type RenderedEmail } from './layout'

function greetingName(firstName: string): string {
  const name = firstName.trim()
  return name || 'there'
}

function httpUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : ''
}

export function verificationEmail(input: {
  brand: EmailBrand
  firstName: string
  email: string
  confirmUrl: string
  expiresAt: Date
  ttlHours: number
}): RenderedEmail {
  const { brand, email, confirmUrl, expiresAt, ttlHours } = input
  const name = greetingName(input.firstName)
  const subject = `Confirm your ${brand.appName} email`
  const intro = `Hi ${name}, you created a driver account for ${brand.companyName}. Confirm this email address to activate it and sign in.`

  const { html, attachments } = renderLayout({
    brand,
    preheader: `Confirm your email to activate your ${brand.appName} driver account.`,
    heading: 'Confirm your email',
    intro,
    cards: [
      {
        label: 'Confirmation',
        title: 'Activate your account',
        pill: `Expires in ${ttlHours} hours`,
        body: 'Open the button below on this phone. The account stays inactive until the address is confirmed.',
      },
      {
        title: 'Was this not you?',
        body: 'If you did not create this account, you can ignore this email. The link expires on its own and nothing else will happen.',
      },
    ],
    meta: [
      { label: 'Recipient', value: email },
      { label: 'Account', value: 'Driver' },
      { label: 'Expires', value: formatUtcStamp(expiresAt) },
    ],
    cta: { href: confirmUrl, label: 'Confirm email address' },
    fallbackUrl: confirmUrl,
    footerNote: `You received this because a driver account was created for ${brand.companyName}.`,
    recipientEmail: email,
  })

  const text = [
    `Hi ${name},`,
    '',
    `Confirm your email address to activate your ${brand.appName} driver account:`,
    '',
    confirmUrl,
    '',
    `This link expires in ${ttlHours} hours (${formatUtcStamp(expiresAt)}).`,
    'If you did not create an account, ignore this email.',
  ].join('\n')

  return { subject, text, html, attachments }
}

export function welcomeEmail(input: {
  brand: EmailBrand
  firstName: string
  email: string
  companyName: string
  portalUrl: string
}): RenderedEmail {
  const { brand, email, portalUrl } = input
  const name = greetingName(input.firstName)
  const company = input.companyName.trim() || brand.companyName
  const subject = `Welcome to ${brand.appName}`
  const intro = `Hi ${name}, your email is confirmed and your ${company} driver account is active. You can sign in and start your shift.`

  const { html, attachments } = renderLayout({
    brand,
    preheader: `Your ${brand.appName} driver account is active.`,
    heading: 'Welcome aboard',
    intro,
    cards: [
      {
        label: 'Account',
        title: 'Your account is active',
        body: 'Email confirmation is complete. Use the same address and password you registered with to sign in on this phone.',
      },
      {
        title: 'On the yard',
        body: 'Clock in from Home when you report for duty. Start a pickup when you are assigned a container. Your dispatcher can help with the first trip.',
      },
    ],
    meta: [
      { label: 'Recipient', value: email },
      { label: 'Account', value: 'Driver' },
      { label: 'Company', value: company },
    ],
    cta: httpUrl(portalUrl) ? { href: portalUrl, label: 'Open driver portal' } : undefined,
    fallbackUrl: httpUrl(portalUrl) || undefined,
    footerNote: `You received this because your ${company} driver account was activated.`,
    recipientEmail: email,
  })

  const text = [
    `Hi ${name},`,
    '',
    `Your email is confirmed and your ${company} driver account is active.`,
    '',
    'Clock in from Home when you report for duty, then start a pickup when you are assigned a container.',
    '',
    portalUrl,
  ].join('\n')

  return { subject, text, html, attachments }
}

export function smtpTestEmail(input: {
  brand: EmailBrand
  email: string
  settingsUrl: string
}): RenderedEmail {
  const { brand, email, settingsUrl } = input
  const subject = `${brand.appName} SMTP test`
  const intro = 'This is a test message from your driver portal. If you are reading it, outbound email is working and driver confirmation mail will be delivered in this same layout.'

  const { html, attachments } = renderLayout({
    brand,
    preheader: 'Outbound SMTP is working.',
    heading: 'Mail delivery confirmed',
    intro,
    cards: [
      {
        label: 'Operator check',
        title: 'SMTP test delivered',
        body: 'Signup confirmation and welcome messages use this template. If the logo is missing, the client is blocking images — the CID attachment is still in the message.',
      },
    ],
    meta: [
      { label: 'Recipient', value: email },
      { label: 'Purpose', value: 'SMTP delivery test' },
    ],
    cta: httpUrl(settingsUrl) ? { href: settingsUrl, label: 'Open admin settings' } : undefined,
    fallbackUrl: httpUrl(settingsUrl) || undefined,
    footerNote: 'You received this because an administrator sent an SMTP test from Settings.',
    recipientEmail: email,
  })

  const text = [
    'This is a test message from your driver portal.',
    '',
    'If you are reading it, outbound email is working and driver verification links will be delivered.',
    settingsUrl ? `\n${settingsUrl}` : '',
  ].filter(Boolean).join('\n')

  return { subject, text, html, attachments }
}
