import { SHIPCSX_POLL_INTERVAL_MS } from '#shared/utils/csx-lookup'
import { runShipcsxPoll } from '../services/shipcsx-poll'

/**
 * In-process ShipCSX poll. One tick every 30 minutes; the service itself
 * no-ops outside 05:00–22:00 America/New_York.
 */
export default defineNitroPlugin((nitro) => {
  const runtime = useRuntimeConfig()
  const enabled = String((runtime as { shipcsx?: { poll?: string } }).shipcsx?.poll
    ?? process.env.NUXT_SHIPCSX_POLL ?? '').toLowerCase() === 'true'
  if (!enabled) return

  const tick = () => {
    void runShipcsxPoll(useDb()).catch((error) => {
      console.warn('[shipcsx-poll]', error instanceof Error ? error.message : error)
    })
  }

  const timer = setInterval(tick, SHIPCSX_POLL_INTERVAL_MS)
  nitro.hooks.hook('close', () => {
    clearInterval(timer)
  })
})
