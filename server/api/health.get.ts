import { sql } from 'drizzle-orm'
import { useMail } from '../services/mail'
import { useOcrService } from '../services/ocr'
import { useObjectStorage } from '../services/storage'

/**
 * Container health probe, also used by the Dockerfile HEALTHCHECK.
 *
 * Optional subsystems report `degraded` rather than failing, so a missing OCR
 * or object-storage service never takes the application down.
 */
export default defineEventHandler(async (event) => {
  const checks: Record<string, { status: 'ok' | 'degraded' | 'error', detail?: string }> = {}

  try {
    await useDb().execute(sql`select 1`)
    checks.database = { status: 'ok' }
  }
  catch (error) {
    checks.database = { status: 'error', detail: error instanceof Error ? error.message : 'unreachable' }
  }

  // Configuration only — an SMTP handshake on every probe would open a
  // connection every 30 seconds. `POST /api/admin/smtp-test` does the live check.
  try {
    checks.mail = useMail().isConfigured()
      ? { status: 'ok', detail: 'SMTP configured. POST /api/admin/smtp-test to verify delivery.' }
      : { status: 'degraded', detail: 'SMTP not configured; mail is logged to the console.' }
  }
  catch (error) {
    checks.mail = {
      status: 'degraded',
      detail: error instanceof Error ? error.message : 'SMTP is not configured.',
    }
  }

  const ocr = await useOcrService().healthCheck()
  checks.ocr = { status: ocr.healthy ? 'ok' : 'degraded', detail: ocr.message }

  const storage = await useObjectStorage().healthCheck()
  checks.storage = { status: storage.healthy ? 'ok' : 'degraded', detail: storage.message }

  const healthy = checks.database?.status === 'ok'
  if (!healthy) setResponseStatus(event, 503)

  return {
    status: healthy ? 'ok' : 'error',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks,
  }
})
