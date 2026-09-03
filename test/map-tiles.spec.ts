import { describe, expect, it } from 'vitest'
import { OSM_TILE_URL, SATELLITE_TILE_URL } from '../shared/utils/map-tiles'

describe('map tile templates', () => {
  it('uses Esri World Imagery z/y/x for satellite and OSM z/x/y for streets', () => {
    expect(SATELLITE_TILE_URL).toContain('World_Imagery')
    expect(SATELLITE_TILE_URL).toContain('{z}/{y}/{x}')
    expect(OSM_TILE_URL).toContain('{z}/{x}/{y}')
  })
})
