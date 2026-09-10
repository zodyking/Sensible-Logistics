/**
 * Keyless raster tiles (Esri ArcGIS Online).
 * ArcGIS tile URLs are z/y/x, not OSM’s z/x/y.
 * Override streets with NUXT_PUBLIC_MAP_TILES_URL and satellite with NUXT_PUBLIC_MAP_SATELLITE_URL.
 */
export const STREET_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
export const STREET_ATTRIBUTION = 'Tiles © Esri — Esri, HERE, Garmin, FAO, NOAA, USGS'
export const OSM_TILE_URL = STREET_TILE_URL
export const OSM_ATTRIBUTION = STREET_ATTRIBUTION

/**
 * Esri World Imagery — keyless aerial/satellite tiles for drawing a yard fence.
 */
export const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const SATELLITE_ATTRIBUTION = 'Tiles © Esri — Esri, Maxar, Earthstar Geographics'

/** Place names on top of satellite. No API key. */
export const LABELS_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
export const LABELS_ATTRIBUTION = 'Tiles © Esri — Esri, HERE, Garmin, FAO, NOAA, USGS'

/** Roads on top of satellite. No API key. */
export const ROADS_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'
export const ROADS_ATTRIBUTION = LABELS_ATTRIBUTION
