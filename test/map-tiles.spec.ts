import { describe, expect, it } from 'vitest'
import { OSM_TILE_URL, SATELLITE_TILE_URL, STREET_TILE_URL } from '../shared/utils/map-tiles'

describe('map tile templates', () => {
  it('uses Carto Voyager z/x/y for streets and Esri World Imagery z/y/x for satellite', () => {
    expect(STREET_TILE_URL).toContain('basemaps.cartocdn.com')
    expect(STREET_TILE_URL).toContain('voyager')
    expect(STREET_TILE_URL).toContain('{z}/{x}/{y}')
    expect(OSM_TILE_URL).toBe(STREET_TILE_URL)
    expect(SATELLITE_TILE_URL).toContain('World_Imagery')
    expect(SATELLITE_TILE_URL).toContain('{z}/{y}/{x}')
  })
})
