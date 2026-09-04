import { driverHoldPrompt } from '#shared/utils/driver-hold'
import { invalidateTripLists } from '~/utils/trip-lists'

export type DriverHold = {
  containerId: string
  driverName: string
  containerNumber?: string | null
}

/**
 * Confirm before taking a container that is still on a driver's live trip.
 * Confirming cancels that trip and clears the claim.
 */
export function useDriverReleasePrompt() {
  const hold = ref<DriverHold | null>(null)
  const releasing = ref(false)
  let resolver: ((ok: boolean) => void) | null = null

  const promptText = computed(() =>
    hold.value ? driverHoldPrompt(hold.value.driverName, hold.value.containerNumber) : '',
  )

  function decide(ok: boolean) {
    const resolve = resolver
    resolver = null
    hold.value = null
    resolve?.(ok)
  }

  function ask(payload: DriverHold) {
    return new Promise<boolean>((resolve) => {
      hold.value = payload
      resolver = resolve
    })
  }

  async function releaseIfNeeded(input: {
    containerId?: string | null
    driverName?: string | null
    containerNumber?: string | null
  } | null | undefined) {
    if (!input?.containerId) return true

    const ok = await ask({
      containerId: input.containerId,
      driverName: input.driverName ?? '',
      containerNumber: input.containerNumber,
    })
    if (!ok) return false

    releasing.value = true
    try {
      await $fetch(`/api/containers/${input.containerId}/release-driver`, { method: 'POST' })
      invalidateTripLists()
      return true
    }
    finally {
      releasing.value = false
    }
  }

  return { hold, releasing, promptText, decide, releaseIfNeeded }
}
