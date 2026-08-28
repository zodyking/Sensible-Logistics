import type { BoundingBox } from '#shared/utils/geo'
import { mapBearingFromStreetHeading } from '#shared/utils/yard-slots'

type LeafletModule = typeof import('leaflet')

/**
 * Leaflet-rotate patches the global `L` object. Vite prefers the package's
 * ESM entry, which assumes that global, so we assign it then load the UMD build.
 */
export async function loadLeaflet(): Promise<LeafletModule> {
  const mod = await import('leaflet')
  const L = (mod.default ?? mod) as LeafletModule
  const globalL = globalThis as typeof globalThis & { L?: LeafletModule }
  globalL.L = L
  await import('leaflet-rotate/dist/leaflet-rotate.js')
  return L
}

export function waitForMapSize(
  el: HTMLElement,
  isCancelled: () => boolean,
  timeoutMs = 2500,
): Promise<boolean> {
  if (el.clientWidth > 8 && el.clientHeight > 8) return Promise.resolve(true)

  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      observer.disconnect()
      clearTimeout(timer)
      resolve(ok)
    }

    const observer = new ResizeObserver(() => {
      if (isCancelled()) {
        finish(false)
        return
      }
      if (el.clientWidth > 8 && el.clientHeight > 8) finish(true)
    })
    observer.observe(el)

    const timer = setTimeout(() => {
      finish(el.clientWidth > 8 && el.clientHeight > 8)
    }, timeoutMs)
  })
}

export function observeMapSize(
  el: HTMLElement,
  onResize: () => void,
): () => void {
  const observer = new ResizeObserver(() => {
    if (el.clientWidth > 8 && el.clientHeight > 8) onResize()
  })
  observer.observe(el)
  return () => observer.disconnect()
}

export async function fetchMapBearing(
  latitude: number,
  longitude: number,
  box?: BoundingBox | null,
): Promise<number> {
  const result = await $fetch('/api/geocode/heading', {
    query: {
      lat: latitude,
      lng: longitude,
      west: box?.west,
      south: box?.south,
      east: box?.east,
      north: box?.north,
    },
  })
  return mapBearingFromStreetHeading(result.heading)
}
