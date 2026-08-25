import type { MailAttachment } from '../mail'
import type { EmailBrand } from './brand'
import { escapeHtml } from './escape'
import { EMAIL_LOGO_CID, logoAttachment } from './logo'

/**
 * Enterprise transactional letter — mobile-first, white canvas.
 *
 * One heading, a short body, and a single action. Email clients still need
 * tables and inline CSS; the chrome is kept out of the way of the copy.
 */

export const EMAIL = {
  white: '#FFFFFF',
  navy: '#0C1E30',
  gold: '#E8A023',
  muted: '#5B6B7C',
  font: `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`,
} as const

export interface LayoutInput {
  brand: EmailBrand
  preheader: string
  heading: string
  greeting?: string
  paragraphs: string[]
  cta?: { href: string, label: string }
  fallbackUrl?: string
  closing?: string
}

export interface RenderedEmail {
  subject: string
  text: string
  html: string
  attachments: MailAttachment[]
}

function logoSrc(brand: EmailBrand): { src: string, attachments: MailAttachment[] } {
  if (brand.logoPath) {
    return { src: `cid:${EMAIL_LOGO_CID}`, attachments: [logoAttachment(brand.logoPath)] }
  }
  if (brand.logoUrl) {
    return { src: brand.logoUrl, attachments: [] }
  }
  return { src: '', attachments: [] }
}

function preheaderBlock(text: string): string {
  const pad = '&#847;&zwnj;&nbsp;'.repeat(30)
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${EMAIL.white};">
    ${escapeHtml(text)}${pad}
  </div>`
}

function logoBlock(brand: EmailBrand, src: string): string {
  if (src) {
    return `<img src="${escapeHtml(src)}" width="200" alt="${escapeHtml(brand.appName)}" style="display:block;margin:0 auto;width:64%;max-width:200px;height:auto;border:0;outline:none;text-decoration:none;">`
  }
  return `<div style="font-family:${EMAIL.font};font-size:13px;font-weight:700;letter-spacing:0.08em;color:${EMAIL.navy};text-align:center;">${escapeHtml(brand.appName)}</div>`
}

function goldRule(): string {
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:16px auto 0;">
    <tr><td style="width:36px;height:2px;background-color:${EMAIL.gold};font-size:0;line-height:0;border-radius:1px;">&nbsp;</td></tr>
  </table>`
}

function bodyCopy(greeting: string | undefined, paragraphs: string[]): string {
  const greetingHtml = greeting
    ? `<p style="margin:0 0 16px;font-family:${EMAIL.font};font-size:16px;line-height:1.55;color:${EMAIL.navy};">${escapeHtml(greeting)}</p>`
    : ''
  const rest = paragraphs.map((paragraph, index) => {
    const margin = index === paragraphs.length - 1 ? '0' : '0 0 16px'
    return `<p style="margin:${margin};font-family:${EMAIL.font};font-size:16px;line-height:1.6;color:${EMAIL.muted};">${escapeHtml(paragraph)}</p>`
  }).join('')
  return `${greetingHtml}${rest}`
}

function ctaButton(href: string, label: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="background-color:${EMAIL.navy};border-radius:6px;">
        <a href="${escapeHtml(href)}" style="display:block;padding:16px 24px;font-family:${EMAIL.font};font-size:16px;font-weight:600;color:${EMAIL.white};text-decoration:none;text-align:center;line-height:1.2;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`
}

function fallbackLink(url: string): string {
  return `<p style="margin:20px 0 0;font-family:${EMAIL.font};font-size:13px;line-height:1.5;color:${EMAIL.muted};">
    Or paste this address into your browser:<br>
    <a href="${escapeHtml(url)}" style="color:${EMAIL.navy};word-break:break-all;text-decoration:underline;">${escapeHtml(url)}</a>
  </p>`
}

/**
 * Shared white letter used by every outbound message so verification, welcome,
 * and the SMTP test stay consistent without turning into a form.
 */
export function renderLayout(input: LayoutInput): { html: string, attachments: MailAttachment[] } {
  const { src, attachments } = logoSrc(input.brand)

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${escapeHtml(input.heading)}</title>
    <style>
      :root { color-scheme: light only; }
      body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
      table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
      body { margin: 0; padding: 0; width: 100% !important; background-color: ${EMAIL.white} !important; }
      @media only screen and (max-width: 620px) {
        .email-pad { padding: 28px 20px !important; }
        .email-h1 { font-size: 24px !important; line-height: 1.3 !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${EMAIL.white};">
    ${preheaderBlock(input.preheader)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${EMAIL.white}" style="background-color:${EMAIL.white};">
      <tr>
        <td align="center" class="email-pad" style="padding:36px 24px;background-color:${EMAIL.white};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:${EMAIL.white};">
            <tr>
              <td style="padding:0 0 8px;text-align:center;">
                ${logoBlock(input.brand, src)}
                ${goldRule()}
              </td>
            </tr>
            <tr>
              <td style="padding:32px 0 0;">
                <h1 class="email-h1" style="margin:0 0 20px;font-family:${EMAIL.font};font-size:26px;font-weight:700;letter-spacing:-0.02em;line-height:1.25;color:${EMAIL.navy};">${escapeHtml(input.heading)}</h1>
                ${bodyCopy(input.greeting, input.paragraphs)}
              </td>
            </tr>
            ${input.cta ? `<tr><td style="padding:28px 0 0;">${ctaButton(input.cta.href, input.cta.label)}${input.fallbackUrl ? fallbackLink(input.fallbackUrl) : ''}</td></tr>` : ''}
            ${input.closing ? `<tr><td style="padding:24px 0 0;"><p style="margin:0;font-family:${EMAIL.font};font-size:14px;line-height:1.55;color:${EMAIL.muted};">${escapeHtml(input.closing)}</p></td></tr>` : ''}
            <tr>
              <td style="padding:36px 0 0;">
                <p style="margin:0;font-family:${EMAIL.font};font-size:13px;line-height:1.5;color:${EMAIL.muted};">
                  ${escapeHtml(input.brand.appName)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { html, attachments }
}
