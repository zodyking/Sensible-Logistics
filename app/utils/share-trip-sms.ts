export interface ShareTripSmsResult {
  copied: boolean
  shared: boolean
  aborted: boolean
}

function isAbort(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  }
  catch {
    try {
      const field = document.createElement('textarea')
      field.value = text
      field.setAttribute('readonly', '')
      field.style.position = 'fixed'
      field.style.left = '-9999px'
      document.body.appendChild(field)
      field.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(field)
      return ok
    }
    catch {
      return false
    }
  }
}

async function tryShare(payload: ShareData): Promise<'shared' | 'aborted' | 'failed'> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return 'failed'
  if (payload.files?.length && navigator.canShare && !navigator.canShare({ files: payload.files })) {
    return 'failed'
  }
  try {
    await navigator.share(payload)
    return 'shared'
  }
  catch (error) {
    if (isAbort(error)) return 'aborted'
    return 'failed'
  }
}

/**
 * Copy the dispatch text first (iOS Messages often drops `text` when files
 * are attached), then open the system share sheet so the driver can send it
 * to an existing conversation.
 */
export async function shareTripSms(options: {
  text: string
  files?: File[]
}): Promise<ShareTripSmsResult> {
  const copied = await copyTextToClipboard(options.text)
  const files = options.files?.filter(file => file.size > 0) ?? []

  const attempts: ShareData[] = []
  if (files.length) {
    attempts.push({ text: options.text, files })
    attempts.push({ files })
  }
  attempts.push({ text: options.text })

  for (const payload of attempts) {
    const outcome = await tryShare(payload)
    if (outcome === 'shared') return { copied, shared: true, aborted: false }
    if (outcome === 'aborted') return { copied, shared: false, aborted: true }
  }

  return { copied, shared: false, aborted: false }
}
