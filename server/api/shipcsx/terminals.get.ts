import { requireAuth } from '../../utils/session'
import { SHIPCSX_TERMINALS } from '#shared/utils/csx-lookup'

/** Fixed CSX facility names for the Check CSX dropdown. No live scrape. */
export default defineEventHandler(async (event) => {
  await requireAuth(event)
  return {
    terminals: [...SHIPCSX_TERMINALS],
    cachedAt: null,
    source: 'static' as const,
    error: null,
  }
})
