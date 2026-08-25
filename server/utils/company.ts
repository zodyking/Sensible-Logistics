import { createHash, timingSafeEqual } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { CYCLE_TYPES } from '#shared/utils/domain'
import type { CycleType } from '#shared/utils/domain'
import { companies } from '../database/schema'
import type { DbExecutor } from './db'

/**
 * Company identity for a single-company deployment (spec 4).
 *
 * The invite code is owned by the operator through `NUXT_COMPANY_INVITE_CODE`,
 * not editable in the app. It is a shared secret that grants access to company
 * data, so rotating it should be a deploy-time action with an audit trail in
 * the environment config — not a button an admin can click.
 *
 * The database keeps its `companies.invite_code` column because the schema is
 * multi-tenant by design (spec 17); this module simply syncs the primary
 * company row to whatever the environment says.
 */

export interface CompanyEnvConfig {
  inviteCode: string
  name: string
  legalName: string | null
  usdotNumber: string | null
  timezone: string
  cycleType: CycleType
}

/**
 * Nuxt parses env values with `destr`, so a numeric-looking variable such as a
 * USDOT number arrives as a number. Coerce before any string handling.
 */
function envString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/** Uppercase and strip separators so `sens-ible` and `SENSIBLE` both match. */
export function normalizeInviteCode(code: unknown): string {
  return envString(code).toUpperCase().replace(/[\s-]/g, '')
}

/**
 * Compares codes without leaking length or content through timing. Digesting
 * first keeps both operands the same length, which `timingSafeEqual` requires.
 */
export function inviteCodeMatches(submitted: unknown, expected: unknown): boolean {
  if (!expected) return false
  const a = createHash('sha256').update(normalizeInviteCode(submitted)).digest()
  const b = createHash('sha256').update(normalizeInviteCode(expected)).digest()
  return timingSafeEqual(a, b)
}

export function readCompanyEnvConfig(): CompanyEnvConfig {
  const config = useRuntimeConfig().company
  const rawCycle = envString(config.cycleType).toUpperCase()

  return {
    inviteCode: normalizeInviteCode(config.inviteCode),
    name: envString(config.name) || 'Container Tracker',
    legalName: envString(config.legalName) || null,
    usdotNumber: envString(config.usdotNumber) || null,
    timezone: envString(config.timezone) || 'America/New_York',
    cycleType: (CYCLE_TYPES as readonly string[]).includes(rawCycle)
      ? rawCycle as CycleType
      : 'SEVENTY_EIGHT',
  }
}

/**
 * Returns the deployment's company, creating it from the environment on a
 * fresh database and syncing the invite code when the operator rotates it.
 *
 * "Primary" is the oldest row, so a seeded demo company is adopted rather than
 * duplicated.
 */
export async function ensurePrimaryCompany(db: DbExecutor) {
  const env = readCompanyEnvConfig()

  const [existing] = await db
    .select()
    .from(companies)
    .orderBy(asc(companies.createdAt))
    .limit(1)

  if (!existing) {
    if (!env.inviteCode) {
      throw createError({
        statusCode: 503,
        statusMessage: 'NUXT_COMPANY_INVITE_CODE is not set, so the company cannot be provisioned.',
      })
    }

    const [created] = await db
      .insert(companies)
      .values({
        name: env.name,
        legalName: env.legalName,
        usdotNumber: env.usdotNumber,
        inviteCode: env.inviteCode,
        timezone: env.timezone,
        cycleType: env.cycleType,
      })
      .returning()

    if (!created) {
      throw createError({ statusCode: 500, statusMessage: 'Could not provision the company.' })
    }
    return created
  }

  if (env.inviteCode && existing.inviteCode !== env.inviteCode) {
    const [updated] = await db
      .update(companies)
      .set({ inviteCode: env.inviteCode, updatedAt: new Date() })
      .where(eq(companies.id, existing.id))
      .returning()

    if (updated) return updated
  }

  return existing
}
