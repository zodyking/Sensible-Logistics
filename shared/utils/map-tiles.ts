/** OSM street raster tiles. */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

/**
 * Esri World Imagery — keyless aerial/satellite tiles for drawing a yard fence.
 * ArcGIS tile URLs are z/y/x, not OSM’s z/x/y.
 */
export const SATELLITE_TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const SATELLITE_ATTRIBUTION = 'Tiles © Esri — Esri, Maxar, Earthstar Geographics'

/** CartoDB transparent labels overlay — street names, POIs on top of satellite. */
export const LABELS_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png'
export const LABELS_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>'
