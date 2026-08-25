import type { EmailBrand } from './brand'
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
  confirmUrl: string
  ttlHours: number
}): RenderedEmail {
  const { brand, confirmUrl, ttlHours } = input
  const name = greetingName(input.firstName)
  const subject = `Confirm your ${brand.appName} email`

  const { html, attachments } = renderLayout({
    brand,
    preheader: `Confirm your email to activate your ${brand.appName} driver account.`,
    heading: 'Confirm your email',
    greeting: `Hi ${name},`,
    paragraphs: [
      `You created a driver account for ${brand.companyName}. Confirm this address to activate it. The link expires in ${ttlHours} hours.`,
    ],
    cta: { href: confirmUrl, label: 'Confirm email address' },
    fallbackUrl: confirmUrl,
    closing: 'If you did not create this account, you can ignore this message.',
  })

  const text = [
    `Hi ${name},`,
    '',
    `You created a driver account for ${brand.companyName}. Confirm this address to activate it:`,
    '',
    confirmUrl,
    '',
    `This link expires in ${ttlHours} hours.`,
    '',
    'If you did not create this account, you can ignore this message.',
    '',
    brand.appName,
  ].join('\n')

  return { subject, text, html, attachments }
}

export function welcomeEmail(input: {
  brand: EmailBrand
  firstName: string
  companyName: string
  portalUrl: string
}): RenderedEmail {
  const { brand, portalUrl } = input
  const name = greetingName(input.firstName)
  const company = input.companyName.trim() || brand.companyName
  const subject = `Welcome to ${brand.appName}`

  const { html, attachments } = renderLayout({
    brand,
    preheader: `Your ${brand.appName} driver account is active.`,
    heading: 'Welcome to the driver portal',
    greeting: `Hi ${name},`,
    paragraphs: [
      `Your email is confirmed and your ${company} driver account is active. Clock in from Home when you report for duty, and start a pickup when you are assigned a container.`,
    ],
    cta: httpUrl(portalUrl) ? { href: portalUrl, label: 'Open driver portal' } : undefined,
    fallbackUrl: httpUrl(portalUrl) || undefined,
  })

  const text = [
    `Hi ${name},`,
    '',
    `Your email is confirmed and your ${company} driver account is active.`,
    '',
    'Clock in from Home when you report for duty, and start a pickup when you are assigned a container.',
    '',
    portalUrl,
    '',
    brand.appName,
  ].join('\n')

  return { subject, text, html, attachments }
}

export function smtpTestEmail(input: {
  brand: EmailBrand
}): RenderedEmail {
  const { brand } = input
  const subject = `${brand.appName} SMTP test`

  const { html, attachments } = renderLayout({
    brand,
    preheader: 'Outbound SMTP is working.',
    heading: 'Mail delivery confirmed',
    paragraphs: [
      'This is a test from the driver portal. Outbound email is working, and driver messages will be delivered in this same format.',
    ],
  })

  const text = [
    'This is a test from the driver portal.',
    '',
    'Outbound email is working, and driver messages will be delivered in this same format.',
    '',
    brand.appName,
  ].join('\n')

  return { subject, text, html, attachments }
}
