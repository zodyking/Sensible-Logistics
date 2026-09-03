/** Extra hold so the mark stays up through a fast save and route change. */
export function brandLoaderRemainMs(started: number, now: number, minMs = 1100) {
  return minMs - (now - started)
}

/**
 * Full-screen company mark shown after sign-in and after a completed
 * pickup, arrival, or add-equipment save. Lives in app root so it
 * stays up across the route change.
 */
export function useBrandLoader() {
  const open = useState('brand-loader-open', () => false)
  const caption = useState('brand-loader-caption', () => '')

  function present(text = '') {
    caption.value = text
    open.value = true
  }

  function dismiss() {
    open.value = false
    caption.value = ''
  }

  async function withLoader<T>(
    work: () => Promise<T>,
    opts?: { caption?: string, minMs?: number },
  ): Promise<T> {
    present(opts?.caption ?? '')
    const started = Date.now()
    try {
      const result = await work()
      const remain = brandLoaderRemainMs(started, Date.now(), opts?.minMs ?? 1100)
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

  return { open, caption, present, dismiss, withLoader }
}
