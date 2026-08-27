/** OSM tile URL — self-hosted when `NUXT_PUBLIC_MAP_TILES_URL` is set. */
export function osmTileUrl(): string {
  const custom = String(useRuntimeConfig().public.mapTilesUrl ?? '').trim()
  return custom || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
}

export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
