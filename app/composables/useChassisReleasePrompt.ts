import { chassisInUsePrompt, chassisNeedsRelease } from '#shared/utils/chassis-conflict'

export type ChassisReleaseConflict = {
  chassisId: string
  chassisNumber: string
  containerNumber: string
}

type ChassisHolder = {
  id: string
  number: string
  currentContainerId?: string | null
  currentContainerNumber?: string | null
}

/**
 * Ask before stealing a chassis that is already under another container.
 * Confirming calls the release API so the following pickup or add can use it.
 */
export function useChassisReleasePrompt() {
  const conflict = ref<ChassisReleaseConflict | null>(null)
  const releasing = ref(false)
  let resolver: ((ok: boolean) => void) | null = null

  const promptText = computed(() =>
    conflict.value ? chassisInUsePrompt(conflict.value.containerNumber) : '',
  )

  function decide(ok: boolean) {
    const resolve = resolver
    resolver = null
    conflict.value = null
    resolve?.(ok)
  }

  function ask(payload: ChassisReleaseConflict) {
    return new Promise<boolean>((resolve) => {
      conflict.value = payload
      resolver = resolve
    })
  }

  async function releaseIfNeeded(item: ChassisHolder, keepContainerId?: string | null) {
    if (!chassisNeedsRelease(item.currentContainerId, keepContainerId)) return true

    const ok = await ask({
      chassisId: item.id,
      chassisNumber: item.number,
      containerNumber: item.currentContainerNumber || '',
    })
    if (!ok) return false

    releasing.value = true
    try {
      await $fetch(`/api/chassis/${item.id}/release`, { method: 'POST' })
      return true
    }
    finally {
      releasing.value = false
    }
  }

  return { conflict, releasing, promptText, decide, releaseIfNeeded }
}
