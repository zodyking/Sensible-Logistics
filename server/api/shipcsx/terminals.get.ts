import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { locations } from '../../database/schema'
import { requireAuth } from '../../utils/session'
import { defaultShipcsxTerminal, listShipcsxTerminals } from '../../services/shipcsx-browser'
import { cleanShipcsxTerminalNames } from '#shared/utils/csx-lookup'
import { shipcsxPublicError } from '#shared/utils/shipcsx-status'

const querySchema = z.object({
  refresh: z.enum(['1', 'true', '0', 'false']).optional(),
})

/** CSX terminal names scraped from the public lookup dropdown. */
export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event)
  const query = readValidatedQuery(event, querySchema)
  const refresh = query.refresh === '1' || query.refresh === 'true'

  const db = useDb()
  const rails = await db
    .select({ shipcsxTerminal: locations.shipcsxTerminal, name: locations.name })
    .from(locations)
    .where(and(
      eq(locations.companyId, auth.companyId),
      eq(locations.type, 'RAIL_TERMINAL'),
      isNull(locations.deletedAt),
    ))

  const hints = cleanShipcsxTerminalNames([
    ...rails.map(row => row.shipcsxTerminal || row.name),
    defaultShipcsxTerminal(),
  ])

  try {
    const live = await listShipcsxTerminals({ refresh })
    const terminals = cleanShipcsxTerminalNames([...live.terminals, ...hints])
    return {
      terminals,
      cachedAt: live.cachedAt,
      source: live.source,
      error: null,
    }
  }
  catch (error) {
    if (hints.length) {
      return {
        terminals: hints,
        cachedAt: null,
        source: 'cache' as const,
        error: shipcsxPublicError(error instanceof Error ? error.message : ''),
      }
    }
    throw createError({
      statusCode: 503,
      statusMessage: shipcsxPublicError(error instanceof Error ? error.message : ''),
    })
  }
})
