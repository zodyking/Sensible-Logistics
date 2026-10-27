import { locationCsvFileName } from '#shared/utils/location-csv'

/** Trigger a same-device file download from a text payload. */
export function downloadTextFile(text: string, fileName: string, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type })
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

export async function downloadLocationDirectoryCsv(locationId?: string) {
  const csv = await $fetch<string>('/api/locations/export', {
    responseType: 'text',
    query: locationId ? { id: locationId } : undefined,
  })
  downloadTextFile(csv, locationCsvFileName(), 'text/csv;charset=utf-8')
}
