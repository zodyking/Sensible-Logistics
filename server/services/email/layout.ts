import type { MailAttachment } from '../mail'
import type { EmailBrand } from './brand'
import { escapeHtml } from './escape'
import { EMAIL_LOGO_CID, logoAttachment } from './logo'

/**
 * Enterprise transactional layout — mobile-first, white canvas.
 *
 * Email clients still need tables and inline CSS. The visual language matches
 * the product (navy, cyan from the mark, restrained gold) without the app's
 * paper-grey shell, which reads as a leftover page background in a mailbox.
 */

export const EMAIL = {
  white: '#FFFFFF',
  navy: '#0C1E30',
  cyan: '#00A8D4',
  gold: '#E8A023',
  muted: '#5B6B7C',
  line: '#E2E8ED',
  pill: '#AE5808',
  font: `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`,
} as const

export interface AccentCard {
  label?: string
  title: string
  body?: string
  pill?: string
}

export interface MetaRow {
  label: string
  value: string
}

export interface LayoutInput {
  brand: EmailBrand
  preheader: string
  heading: string
  intro: string
  cards?: AccentCard[]
  meta?: MetaRow[]
  cta?: { href: string, label: string }
  fallbackUrl?: string
  footerNote: string
  recipientEmail: string
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
    return `<img src="${escapeHtml(src)}" width="220" alt="${escapeHtml(brand.appName)}" style="display:block;margin:0 auto;width:70%;max-width:220px;height:auto;border:0;outline:none;text-decoration:none;">`
  }
  return `<div style="font-family:${EMAIL.font};font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${EMAIL.navy};text-align:center;">${escapeHtml(brand.appName)}</div>`
}

function goldRule(): string {
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:16px auto 0;">
    <tr><td style="width:36px;height:2px;background-color:${EMAIL.gold};font-size:0;line-height:0;border-radius:1px;">&nbsp;</td></tr>
  </table>`
}

function accentCard(card: AccentCard): string {
  const label = card.label
    ? `<div style="font-family:${EMAIL.font};font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${EMAIL.muted};margin:0 0 6px;">${escapeHtml(card.label)}</div>`
    : ''
  const pill = card.pill
    ? `<div style="margin:12px 0 0;">
        <span style="display:inline-block;border:1px solid ${EMAIL.gold};color:${EMAIL.pill};border-radius:999px;padding:5px 12px;font-family:${EMAIL.font};font-size:12px;font-weight:600;line-height:1.2;">${escapeHtml(card.pill)}</span>
      </div>`
    : ''
  const body = card.body
    ? `<p style="margin:8px 0 0;font-family:${EMAIL.font};font-size:14px;line-height:1.5;color:${EMAIL.muted};">${escapeHtml(card.body)}</p>`
    : ''

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${EMAIL.line};border-radius:8px;border-collapse:separate;overflow:hidden;">
    <tr>
      <td style="width:4px;max-width:4px;background-color:${EMAIL.cyan};font-size:0;line-height:0;">&nbsp;</td>
      <td style="padding:16px 18px;">
        ${label}
        <div style="font-family:${EMAIL.font};font-size:18px;font-weight:700;line-height:1.3;color:${EMAIL.navy};">${escapeHtml(card.title)}</div>
        ${pill}
        ${body}
      </td>
    </tr>
  </table>`
}

function metaTable(rows: MetaRow[]): string {
  if (!rows.length) return ''
  const cells = rows.map((row, index) => {
    const border = index === rows.length - 1 ? 'none' : `1px solid ${EMAIL.line}`
    return `<tr>
      <td style="padding:12px 0;border-bottom:${border};font-family:${EMAIL.font};font-size:13px;color:${EMAIL.muted};width:42%;">${escapeHtml(row.label)}</td>
      <td style="padding:12px 0 12px 12px;border-bottom:${border};font-family:${EMAIL.font};font-size:13px;font-weight:700;color:${EMAIL.navy};text-align:right;word-break:break-word;">${escapeHtml(row.value)}</td>
    </tr>`
  }).join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cells}</table>`
}

function ctaButton(href: string, label: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="background-color:${EMAIL.navy};border-radius:8px;">
        <a href="${escapeHtml(href)}" style="display:block;padding:16px 24px;font-family:${EMAIL.font};font-size:16px;font-weight:700;color:${EMAIL.white};text-decoration:none;text-align:center;line-height:1.2;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`
}

function fallbackLink(url: string): string {
  return `<p style="margin:16px 0 0;font-family:${EMAIL.font};font-size:12px;line-height:1.5;color:${EMAIL.muted};">
    If the button does not open, paste this address into your browser:<br>
    <a href="${escapeHtml(url)}" style="color:${EMAIL.cyan};word-break:break-all;text-decoration:none;">${escapeHtml(url)}</a>
  </p>`
}

/**
 * Wrap body sections in the shared white, single-column shell used by every
 * outbound message so verification, welcome, and the SMTP test stay consistent.
 */
export function renderLayout(input: LayoutInput): { html: string, attachments: MailAttachment[] } {
  const { src, attachments } = logoSrc(input.brand)
  const cards = (input.cards ?? []).map((card, index) => {
    const spacer = index === 0 ? '' : `<div style="height:12px;line-height:12px;font-size:0;">&nbsp;</div>`
    return `${spacer}${accentCard(card)}`
  }).join('')

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
        .email-pad { padding: 28px 16px !important; }
        .email-h1 { font-size: 26px !important; line-height: 1.25 !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${EMAIL.white};">
    ${preheaderBlock(input.preheader)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${EMAIL.white}" style="background-color:${EMAIL.white};">
      <tr>
        <td align="center" class="email-pad" style="padding:32px 16px;background-color:${EMAIL.white};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background-color:${EMAIL.white};">
            <tr>
              <td style="padding:0 8px 8px;text-align:center;">
                ${logoBlock(input.brand, src)}
                ${goldRule()}
              </td>
            </tr>
            <tr>
              <td style="padding:28px 8px 0;">
                <h1 class="email-h1" style="margin:0 0 12px;font-family:${EMAIL.font};font-size:28px;font-weight:700;letter-spacing:-0.02em;line-height:1.2;color:${EMAIL.navy};">${escapeHtml(input.heading)}</h1>
                <p style="margin:0;font-family:${EMAIL.font};font-size:15px;line-height:1.55;color:${EMAIL.muted};">${escapeHtml(input.intro)}</p>
              </td>
            </tr>
            ${cards ? `<tr><td style="padding:24px 8px 0;">${cards}</td></tr>` : ''}
            ${(input.meta ?? []).length ? `<tr><td style="padding:8px 8px 0;">${metaTable(input.meta ?? [])}</td></tr>` : ''}
            ${input.cta ? `<tr><td style="padding:28px 8px 0;">${ctaButton(input.cta.href, input.cta.label)}${input.fallbackUrl ? fallbackLink(input.fallbackUrl) : ''}</td></tr>` : ''}
            <tr>
              <td style="padding:32px 8px 0;border-top:0;">
                <p style="margin:0;font-family:${EMAIL.font};font-size:12px;line-height:1.5;color:${EMAIL.muted};">
                  ${escapeHtml(input.footerNote)}<br>
                  Sent to ${escapeHtml(input.recipientEmail)}. This mailbox is not monitored.
                </p>
                <p style="margin:16px 0 0;font-family:${EMAIL.font};font-size:12px;font-weight:600;letter-spacing:0.02em;color:${EMAIL.muted};">
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
