import { and, eq, sql } from 'drizzle-orm'
import { companies, companyMemberships, containers, drivers, locations, trucks } from '../../database/schema'
import { useGeocoder } from '../../services/geocoding'
import { useMail } from '../../services/mail'
import { useOcrService } from '../../services/ocr'
import { useObjectStorage } from '../../services/storage'
import { requireAdmin } from '../../utils/session'

/**
 * SMTP configuration state. Deliberately does not open a connection: this runs
 * on every settings load, and a handshake belongs in the explicit test send.
 */
function mailStatus(): { healthy: boolean, message: string } {
  try {
    return useMail().isConfigured()
      ? { healthy: true, message: 'SMTP configured. Send a test message to confirm delivery.' }
      : { healthy: false, message: 'Not configured — verification mail is written to the server log.' }
  }
  catch (error) {
    return { healthy: false, message: error instanceof Error ? error.message : 'SMTP is not configured.' }
  }
}

/** Company settings plus the deployment status of each self-hosted subsystem. */
export default defineEventHandler(async (event) => {
  const auth = await requireAdmin(event)
  const db = useDb()

  const [company] = await db.select().from(companies).where(eq(companies.id, auth.companyId)).limit(1)

  if (!company) {
    throw createError({ statusCode: 404, statusMessage: 'Company not found.' })
  }

  const [counts] = await db
    .select({
      containers: sql<number>`(select count(*)::int from ${containers} where company_id = ${auth.companyId})`,
      activeContainers: sql<number>`(select count(*)::int from ${containers} where company_id = ${auth.companyId} and active_pool_state <> 'INACTIVE')`,
      locations: sql<number>`(select count(*)::int from ${locations} where company_id = ${auth.companyId} and deleted_at is null)`,
      drivers: sql<number>`(select count(*)::int from ${drivers} where company_id = ${auth.companyId})`,
      trucks: sql<number>`(select count(*)::int from ${trucks} where company_id = ${auth.companyId})`,
      admins: sql<number>`(select count(*)::int from ${companyMemberships} where company_id = ${auth.companyId} and role = 'ADMIN')`,
    })
    .from(companies)
    .where(eq(companies.id, auth.companyId))
    .limit(1)

  const [ocr, storage, geocoder] = await Promise.all([
    useOcrService().healthCheck(),
    useObjectStorage().healthCheck(),
    useGeocoder().healthCheck(),
  ])

  const [adminCount] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(companyMemberships)
    .where(and(eq(companyMemberships.companyId, auth.companyId), eq(companyMemberships.role, 'ADMIN')))

  return {
    company: {
      id: company.id,
      name: company.name,
      legalName: company.legalName,
      usdotNumber: company.usdotNumber,
      timezone: company.timezone,
      cycleType: company.cycleType,
      inviteCode: company.inviteCode,
    },
    counts: { ...counts, admins: adminCount?.value ?? 0 },
    mail: mailStatus(),
    services: [
      { key: 'ocr', name: 'OpenOCR (RepViT DB + RepSVTR Mobile)', healthy: ocr.healthy, detail: ocr.message, phase: 'Phase 1' },
      { key: 'storage', name: 'SeaweedFS object storage', healthy: storage.healthy, detail: storage.message, phase: 'Phase 2' },
      { key: 'geocoder', name: 'OpenStreetMap / Photon', healthy: geocoder.healthy, detail: geocoder.message, phase: 'Phase 1' },
      { key: 'tiles', name: 'Planetiler / PMTiles vector tiles', healthy: false, detail: 'Regional tile archive not generated yet.', phase: 'Phase 2' },
      { key: 'realtime', name: 'WebSocket live updates', healthy: false, detail: 'Polling is used in Phase 1.', phase: 'Phase 2' },
      { key: 'jobs', name: 'pg-boss background jobs', healthy: false, detail: 'Job queue not enabled in Phase 1.', phase: 'Phase 2' },
    ],
    retention: {
      timecardMonths: 6,
      note: 'Short-haul time records are retained for at least 6 months and cannot be deleted inside that window.',
    },
  }
})
