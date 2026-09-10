import { describe, expect, it } from 'vitest'
import {
  LABELS_TILE_URL,
  OSM_TILE_URL,
  ROADS_TILE_URL,
  SATELLITE_TILE_URL,
  STREET_TILE_URL,
} from '../shared/utils/map-tiles'

describe('map tile templates', () => {
  it('uses keyless Esri World Street Map and World Imagery (z/y/x)', () => {
    expect(STREET_TILE_URL).toContain('World_Street_Map')
    expect(STREET_TILE_URL).toContain('{z}/{y}/{x}')
    expect(STREET_TILE_URL).not.toContain('cartocdn')
    expect(OSM_TILE_URL).toBe(STREET_TILE_URL)
    expect(SATELLITE_TILE_URL).toContain('World_Imagery')
    expect(SATELLITE_TILE_URL).toContain('{z}/{y}/{x}')
    expect(LABELS_TILE_URL).toContain('World_Boundaries_and_Places')
    expect(LABELS_TILE_URL).not.toContain('cartocdn')
    expect(ROADS_TILE_URL).toContain('World_Transportation')
  })
})
