import { randomUUID } from 'node:crypto'
import process from 'node:process'
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { formatSmtpFromHeader, parseSmtpFromHeader, smtpFromDomain } from '#shared/utils/smtp-from'

/**
 * Outbound email boundary (spec 4 — driver email verification).
 *
 * SMTP is configured entirely through environment variables so credentials never
 * live in the database or the UI. Deliverability is the operator's concern: point
 * the host at a mailbox that already has working SPF, DKIM and DMARC rather than
 * sending from a bare application server.
 */

export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface MailService {
  send(message: MailMessage): Promise<void>
  isConfigured(): boolean
  healthCheck(): Promise<{ healthy: boolean, message: string }>
}

interface SmtpSettings {
  host: string
  port: number
  /** Implicit TLS. Derived from the port: only 465 speaks TLS from the first byte. */
  secure: boolean
  user: string
  password: string
  /** Complete From header, e.g. `"Sensible Logistics" <no-reply@example.com>`. */
  from: string
}

function envValue(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]
    if (value != null && String(value).trim() !== '') return String(value).trim()
  }
  return ''
}

/**
 * Runtime config first, then plain environment variables.
 *
 * The unprefixed `SMTP_*` names are accepted alongside the Nuxt-prefixed ones
 * because they are the conventional spelling and are what most panels (and our
 * other deployments) already have set.
 */
function readSetting(configValue: unknown, ...envNames: string[]): string {
  const fromConfig = String(configValue ?? '').trim()
  return fromConfig || envValue(...envNames)
}

function readSmtpSettings(): SmtpSettings | null {
  const config = useRuntimeConfig().smtp

  const host = readSetting(config.host, 'NUXT_SMTP_HOST', 'SMTP_HOST')
  if (!host) return null

  const port = Number(readSetting(config.port, 'NUXT_SMTP_PORT', 'SMTP_PORT')) || 587
  const user = readSetting(config.user, 'NUXT_SMTP_USER', 'SMTP_USER')
  const password = readSetting(config.password, 'NUXT_SMTP_PASSWORD', 'SMTP_PASSWORD', 'SMTP_PASS')

  // A single full header wins; otherwise the address and display name are
  // assembled from their own variables.
  const fullFrom = readSetting(config.from, 'NUXT_SMTP_FROM', 'SMTP_FROM')
  const parsed = parseSmtpFromHeader(fullFrom)
  const fromEmail = parsed.fromAddress
    || readSetting(config.fromEmail, 'NUXT_SMTP_FROM_EMAIL', 'SMTP_FROM_EMAIL')
    // Most providers only accept a From that matches the authenticated mailbox,
    // so the login is the safest default rather than a hard failure.
    || user
  const fromName = parsed.fromName
    || readSetting(config.fromName, 'NUXT_SMTP_FROM_NAME', 'SMTP_FROM_NAME')

  if (!fromEmail) {
    throw createError({
      statusCode: 503,
      statusMessage: 'SMTP is configured without a From address. Set NUXT_SMTP_FROM_EMAIL (or NUXT_SMTP_USER) to the mailbox that sends the mail.',
    })
  }

  const secureOverride = readSetting(undefined, 'NUXT_SMTP_SECURE', 'SMTP_SECURE').toLowerCase()
  // Implicit TLS is a property of the port, not a preference: asking for it on
  // 587 makes the handshake hang until the socket times out.
  const secure = port === 465
  if (secureOverride === 'true' && !secure) {
    console.warn(
      `[mail] ignoring SMTP secure=true on port ${port}: implicit TLS is only valid on 465. `
      + 'Using STARTTLS instead — set port 465 for implicit TLS.',
    )
  }

  return { host, port, secure, user, password, from: formatSmtpFromHeader(fromName, fromEmail) }
}

/** Nodemailer errors carry the provider's reply; without it logs are unusable. */
function describeSmtpError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const smtp = error as Error & { responseCode?: number, response?: string, command?: string }
  const parts = [smtp.message]
  if (smtp.responseCode) parts.push(`code ${smtp.responseCode}`)
  if (smtp.response && !smtp.message.includes(smtp.response)) parts.push(smtp.response)
  if (smtp.command) parts.push(`command ${smtp.command}`)
  return parts.join(' — ')
}

class SmtpMailService implements MailService {
  private transporter: Transporter | undefined

  constructor(private readonly settings: SmtpSettings) {}

  private transport(): Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: this.settings.host,
        port: this.settings.port,
        secure: this.settings.secure,
        auth: this.settings.user
          ? { user: this.settings.user, pass: this.settings.password }
          : undefined,
        // Never hand credentials to a server that will not upgrade the socket.
        // Anonymous relays (a mail container on the internal network, port 25)
        // stay opportunistic so they are not broken by this.
        requireTLS: !this.settings.secure && Boolean(this.settings.user),
        // Without these a blocked outbound port hangs the request until the
        // platform kills it, and the driver sees a spinner instead of an error.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 30_000,
      })
    }
    return this.transporter
  }

  isConfigured(): boolean {
    return true
  }

  async send(message: MailMessage): Promise<void> {
    const domain = smtpFromDomain(this.settings.from) ?? 'localhost'

    try {
      await this.transport().sendMail({
        from: this.settings.from,
        to: message.to,
        subject: message.subject.trim(),
        text: message.text,
        html: message.html,
        // A stable, domain-matched Message-ID keeps transactional mail out of
        // spam and makes deliveries traceable in the provider's logs.
        messageId: `<mail.${randomUUID()}@${domain}>`,
        headers: { 'X-Entity-Ref-ID': randomUUID() },
      })
    }
    catch (error) {
      const detail = describeSmtpError(error)
      console.error(`[mail] delivery to ${message.to} failed via ${this.settings.host}:${this.settings.port} — ${detail}`)
      throw new Error(`SMTP delivery failed: ${detail}`, { cause: error })
    }
  }

  async healthCheck() {
    try {
      await this.transport().verify()
      return {
        healthy: true,
        message: `SMTP ready at ${this.settings.host}:${this.settings.port} as ${this.settings.from}.`,
      }
    }
    catch (error) {
      return { healthy: false, message: `SMTP unreachable: ${describeSmtpError(error)}` }
    }
  }
}

/**
 * Development fallback: prints the message instead of sending it, so signup can
 * be exercised locally without SMTP credentials. Never selected in production —
 * silently swallowing verification mail there would strand real drivers.
 */
class ConsoleMailService implements MailService {
  isConfigured(): boolean {
    return false
  }

  async send(message: MailMessage): Promise<void> {
    console.info(
      `\n[mail] SMTP not configured — message not sent.\n`
      + `       To:      ${message.to}\n`
      + `       Subject: ${message.subject}\n\n`
      + `${message.text}\n`,
    )
  }

  async healthCheck() {
    return { healthy: false, message: 'NUXT_SMTP_HOST is not set; mail is logged to the console.' }
  }
}

let instance: MailService | undefined

export function useMail(): MailService {
  if (instance) return instance

  const settings = readSmtpSettings()
  if (settings) {
    instance = new SmtpMailService(settings)
  }
  else if (import.meta.dev) {
    instance = new ConsoleMailService()
  }
  else {
    throw createError({
      statusCode: 503,
      statusMessage: 'Email is not configured. Set NUXT_SMTP_HOST, NUXT_SMTP_USER and NUXT_SMTP_PASSWORD.',
    })
  }

  return instance
}

/** Drops the cached transporter so the next send re-reads the environment. */
export function resetMail(): void {
  instance = undefined
}

/** Absolute base URL for links in email. Never derived from the Host header. */
export function appBaseUrl(): string {
  const configured = String(useRuntimeConfig().appUrl ?? '').trim().replace(/\/+$/, '')
  if (configured) return configured
  if (import.meta.dev) return 'http://localhost:3000'
  throw createError({
    statusCode: 503,
    statusMessage: 'NUXT_APP_URL is not set, so verification links cannot be built.',
  })
}
