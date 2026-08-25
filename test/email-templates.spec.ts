import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EmailBrand } from '../server/services/email/brand'
import { escapeHtml, formatUtcStamp } from '../server/services/email/escape'
import { EMAIL } from '../server/services/email/layout'
import { smtpTestEmail, verificationEmail, welcomeEmail } from '../server/services/email/messages'

function brand(overrides: Partial<EmailBrand> = {}): EmailBrand {
  const logoPath = join(process.cwd(), 'public/brand/logo.png')
  return {
    appName: 'Sensible Logistics Solutions LLC',
    companyName: 'Sensible Logistics Solutions LLC',
    appUrl: 'https://tracker.example.com',
    logoUrl: 'https://tracker.example.com/brand/logo.png',
    logoPath: existsSync(logoPath) ? logoPath : null,
    ...overrides,
  }
}

const expiresAt = new Date('2026-08-26T16:00:00.000Z')

describe('escapeHtml', () => {
  it('encodes markup so a name cannot break the template', () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)"> & 'quote'`)).toBe(
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quote&#39;',
    )
  })
})

describe('formatUtcStamp', () => {
  it('renders a stable UTC label', () => {
    expect(formatUtcStamp(expiresAt)).toBe('26 Aug 2026, 16:00 UTC')
  })
})

describe('transactional email templates', () => {
  it('reads as a single letter on a white canvas', () => {
    const { html } = verificationEmail({
      brand: brand(),
      firstName: 'Alex',
      confirmUrl: 'https://tracker.example.com/verify-email?token=abc',
      ttlHours: 24,
    })

    expect(html).toContain(`background-color:${EMAIL.white}`)
    expect(html).not.toContain('#EDF0F2')
    expect(html).toContain('max-width:480px')
    expect(html).toContain(EMAIL.navy)
    expect(html).toContain('Hi Alex,')
    expect(html).toContain('Confirm your email')
    expect(html).toContain('Confirm email address')
    expect(html).toContain('expires in 24 hours')
    expect(html).toContain('cid:logo@sensible-logistics')
    expect(html).not.toContain('Recipient')
    expect(html).not.toContain('Was this not you?')
    expect(html).not.toContain('Activate your account')
  })

  it('inlines the brand mark when the PNG is on disk', () => {
    const rendered = verificationEmail({
      brand: brand(),
      firstName: 'Alex',
      confirmUrl: 'https://tracker.example.com/verify-email?token=abc',
      ttlHours: 24,
    })

    expect(rendered.attachments).toEqual([
      expect.objectContaining({
        filename: 'logo.png',
        cid: 'logo@sensible-logistics',
        contentDisposition: 'inline',
      }),
    ])
  })

  it('escapes untrusted copy in the verification message', () => {
    const { html, text } = verificationEmail({
      brand: brand(),
      firstName: '<script>alert(1)</script>',
      confirmUrl: 'https://tracker.example.com/verify-email?token=a&b',
      ttlHours: 24,
    })

    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('token=a&amp;b')
    expect(text).toContain('<script>alert(1)</script>')
  })

  it('renders a welcome letter after confirmation', () => {
    const { html, subject, text } = welcomeEmail({
      brand: brand(),
      firstName: 'Alex',
      companyName: 'Sensible Logistics Solutions LLC',
      portalUrl: 'https://tracker.example.com',
    })

    expect(subject).toBe('Welcome to Sensible Logistics Solutions LLC')
    expect(html).toContain('Welcome to the driver portal')
    expect(html).toContain('Open driver portal')
    expect(html).not.toContain('On the yard')
    expect(html).not.toContain('Recipient')
    expect(html).not.toContain('>Account<')
    expect(html).not.toContain('>Company<')
    expect(html).toContain(`background-color:${EMAIL.white}`)
    expect(text).toContain('https://tracker.example.com')
  })

  it('renders the SMTP test as the same letter', () => {
    const { html, subject } = smtpTestEmail({
      brand: brand(),
    })

    expect(subject).toBe('Sensible Logistics Solutions LLC SMTP test')
    expect(html).toContain('Mail delivery confirmed')
    expect(html).not.toContain('Open admin settings')
    expect(html).not.toContain('Recipient')
    expect(html).not.toContain('Operator check')
    expect(html).toContain('max-width:480px')
  })

  it('omits a CTA when the portal URL is not absolute', () => {
    const { html } = welcomeEmail({
      brand: brand({ appUrl: '' }),
      firstName: 'Alex',
      companyName: 'Sensible Logistics Solutions LLC',
      portalUrl: '',
    })

    expect(html).not.toContain('Open driver portal')
  })
})
