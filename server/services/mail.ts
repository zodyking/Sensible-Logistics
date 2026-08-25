import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'

/**
 * Outbound email boundary (spec 4 — driver email verification).
 *
 * SMTP is configured entirely through environment variables so credentials
 * never live in the database or the UI. Deliverability is the operator's
 * concern: point `NUXT_SMTP_HOST` at a mailbox that already has working SPF,
 * DKIM and DMARC rather than sending from a bare application server.
 */

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export interface MailService {
  send(message: MailMessage): Promise<void>
  isConfigured(): boolean
  healthCheck(): Promise<{ healthy: boolean, message: string }>
}

interface SmtpSettings {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  from: string
}

/** Env values arrive via `destr`, so ports and booleans may not be strings. */
function readSmtpSettings(): SmtpSettings | null {
  const config = useRuntimeConfig().smtp
  const host = String(config.host ?? '').trim()
  if (!host) return null

  const port = Number(config.port) || 587
  const from = String(config.from ?? '').trim()
  if (!from) {
    throw createError({
      statusCode: 503,
      statusMessage: 'NUXT_SMTP_FROM is not set. This is the From address shown to recipients and is separate from NUXT_SMTP_USER (SMTP login).',
    })
  }

  return {
    host,
    port,
    // Implicit TLS on 465; 587 upgrades with STARTTLS.
    secure: String(config.secure ?? '').toLowerCase() === 'true' || port === 465,
    user: String(config.user ?? '').trim(),
    password: String(config.password ?? ''),
    from,
  }
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
      })
    }
    return this.transporter
  }

  isConfigured(): boolean {
    return true
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.settings.from) {
      throw createError({
        statusCode: 503,
        statusMessage: 'NUXT_SMTP_FROM is not set. This is the From address shown to recipients and is separate from NUXT_SMTP_USER (SMTP login).',
      })
    }

    await this.transport().sendMail({
      from: this.settings.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    })
  }

  async healthCheck() {
    try {
      await this.transport().verify()
      return { healthy: true, message: `SMTP ready at ${this.settings.host}:${this.settings.port}.` }
    }
    catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { healthy: false, message: `SMTP unreachable: ${detail}` }
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
      statusMessage: 'Email is not configured. Set NUXT_SMTP_HOST and related SMTP variables.',
    })
  }

  return instance
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
