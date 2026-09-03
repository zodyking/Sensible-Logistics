import {
  LABELS_ATTRIBUTION,
  LABELS_TILE_URL,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  SATELLITE_ATTRIBUTION,
  SATELLITE_TILE_URL,
} from '#shared/utils/map-tiles'

export {
  LABELS_ATTRIBUTION,
  LABELS_TILE_URL,
  OSM_ATTRIBUTION,
  OSM_TILE_URL,
  SATELLITE_ATTRIBUTION,
  SATELLITE_TILE_URL,
}

/** OSM street tiles — self-hosted when `NUXT_PUBLIC_MAP_TILES_URL` is set. */
export function osmTileUrl(): string {
  const custom = String(useRuntimeConfig().public.mapTilesUrl ?? '').trim()
  return custom || OSM_TILE_URL
}

/** Aerial/satellite tiles for drawing a yard zone. */
export function satelliteTileUrl(): string {
  const custom = String(useRuntimeConfig().public.mapSatelliteUrl ?? '').trim()
  return custom || SATELLITE_TILE_URL
}
