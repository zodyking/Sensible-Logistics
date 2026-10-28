import { readDeviceGps } from '~/utils/device-gps'

/**
 * Fill today's short-haul card in the background from the phone GPS while a
 * driver has the app open. Denied location never blocks a pickup.
 */
export default defineNuxtPlugin(() => {
  const { loggedIn, user } = useUserSession()
  let timer: number | null = null
  let live = false
  let inFlight = false

  async function ping() {
    if (inFlight) return
    if (document.visibilityState === 'hidden') return
    if (!loggedIn.value || user.value?.role !== 'DRIVER') return
    const gps = await readDeviceGps({ timeoutMs: 12_000, maximumAgeMs: 30_000 })
    if (!gps) return
    inFlight = true
    try {
      const result = await $fetch('/api/time-cards/ping', {
        method: 'POST',
        body: gps,
      })
      live = Boolean(result.live)
    }
    catch {
      // Stay quiet — a missed ping must not surface as a driver error.
    }
    finally {
      inFlight = false
    }
  }

  function stop() {
    if (timer != null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  function schedule(delayMs: number) {
    stop()
    timer = window.setTimeout(async () => {
      await ping()
      schedule(live ? 90_000 : 180_000)
    }, delayMs)
  }

  function start() {
    if (!loggedIn.value || user.value?.role !== 'DRIVER') {
      stop()
      return
    }
    schedule(4_000)
  }

  watch([loggedIn, () => user.value?.role], start, { immediate: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(1_000)
  })
})
