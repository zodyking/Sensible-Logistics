/** Full play of the logo animation. Keep the mark up at least this long. */
export const BRAND_LOADER_MIN_MS = 5000

/** Caption under the mark after a pickup, arrival, or add-equipment save. */
export const BRAND_LOADER_SAVE_CAPTION = 'Saving'

/** Extra hold so the mark stays up through a fast save and route change. */
export function brandLoaderRemainMs(started: number, now: number, minMs = BRAND_LOADER_MIN_MS) {
  return minMs - (now - started)
}

/**
 * Full-screen company mark shown after sign-in and after a completed
 * pickup, arrival, or add-equipment save. Lives in app root so it
 * stays up across the route change.
 */
let leaveTimer: ReturnType<typeof setTimeout> | undefined

export function useBrandLoader() {
  const open = useState('brand-loader-open', () => false)
  const leaving = useState('brand-loader-leaving', () => false)
  const caption = useState('brand-loader-caption', () => '')

  function present(text = '') {
    if (leaveTimer) {
      clearTimeout(leaveTimer)
      leaveTimer = undefined
    }
    caption.value = text
    leaving.value = false
    open.value = true
  }

  function dismiss() {
    if (!open.value || leaving.value) return
    leaving.value = true
    leaveTimer = setTimeout(() => {
      open.value = false
      leaving.value = false
      caption.value = ''
      leaveTimer = undefined
    }, 480)
  }

  async function withLoader<T>(
    work: () => Promise<T>,
    opts?: { caption?: string, minMs?: number },
  ): Promise<T> {
    present(opts?.caption ?? BRAND_LOADER_SAVE_CAPTION)
    const started = Date.now()
    try {
      const result = await work()
      const remain = brandLoaderRemainMs(started, Date.now(), opts?.minMs ?? BRAND_LOADER_MIN_MS)
      if (remain > 0) {
        await new Promise(resolve => setTimeout(resolve, remain))
      }
      return result
    }
    catch (error) {
      dismiss()
      throw error
    }
    finally {
      if (open.value) dismiss()
    }
  }

  return { open, leaving, caption, present, dismiss, withLoader }
}
