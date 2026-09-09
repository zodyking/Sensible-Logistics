import { describe, expect, it } from 'vitest'
import { inventoryViewFromQuery } from '../shared/utils/inventory-view'

describe('inventoryViewFromQuery', () => {
  it('opens locations by default', () => {
    expect(inventoryViewFromQuery(undefined)).toBe('locations')
    expect(inventoryViewFromQuery('')).toBe('locations')
    expect(inventoryViewFromQuery('locations')).toBe('locations')
  })

  it('opens containers only for that exact query', () => {
    expect(inventoryViewFromQuery('containers')).toBe('containers')
  })

  it('ignores unknown views', () => {
    expect(inventoryViewFromQuery('billing')).toBe('locations')
    expect(inventoryViewFromQuery(['containers'])).toBe('locations')
  })
})
