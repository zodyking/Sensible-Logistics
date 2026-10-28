export type DeviceGps = {
  latitude: number
  longitude: number
  accuracyMeters?: number
}

function isGps(value: GeolocationPosition | null | undefined): DeviceGps | null {
  const coords = value?.coords
  if (!coords) return null
  if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return null
  if (coords.latitude === 0 && coords.longitude === 0) return null
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracyMeters: Number.isFinite(coords.accuracy) ? coords.accuracy : undefined,
  }
}

/** Current device fix. Permission denied or timeout returns null — never throws. */
export function readDeviceGps(options?: {
  timeoutMs?: number
  maximumAgeMs?: number
}): Promise<DeviceGps | null> {
  if (!import.meta.client || typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve(null)
  }
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), (options?.timeoutMs ?? 8000) + 250)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer)
        resolve(isGps(position))
      },
      () => {
        window.clearTimeout(timer)
        resolve(null)
      },
      {
        enableHighAccuracy: true,
        timeout: options?.timeoutMs ?? 8000,
        maximumAge: options?.maximumAgeMs ?? 20_000,
      },
    )
  })
}

export async function attachDeviceGps<T extends Record<string, unknown>>(body: T): Promise<T> {
  const gps = await readDeviceGps()
  if (!gps) return body
  return { ...body, gps }
}
