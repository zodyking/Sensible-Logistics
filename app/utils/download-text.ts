import { locationCsvFileName } from '#shared/utils/location-csv'

/** Trigger a same-device file download from a blob. */
export function downloadBlobFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Open a blob in a new tab. Falls back to a download if the popup is blocked. */
export function openBlobInNewTab(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const opened = window.open(url, '_blank', 'noopener')
  if (opened) {
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return
  }
  URL.revokeObjectURL(url)
  downloadBlobFile(blob, fileName)
}

/** Trigger a same-device file download from a text payload. */
export function downloadTextFile(text: string, fileName: string, type = 'text/plain;charset=utf-8') {
  downloadBlobFile(new Blob([text], { type }), fileName)
}

export async function downloadLocationDirectoryCsv(locationId?: string) {
  const csv = await $fetch<string>('/api/locations/export', {
    responseType: 'text',
    query: locationId ? { id: locationId } : undefined,
  })
  downloadTextFile(csv, locationCsvFileName(), 'text/csv;charset=utf-8')
}
