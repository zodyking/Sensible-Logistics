import { describe, expect, it } from 'vitest'
import { mergeSiteContainers } from '../shared/utils/pickup-inventory'

describe('pickup site inventory', () => {
  it('unions location and inventory rows so a box only in one list still appears', () => {
    const merged = mergeSiteContainers(
      [{ id: 'a', number: 'CAIU1111110', isLoaded: false, sealNumber: null }],
      [
        { id: 'a', number: 'CAIU1111110', isLoaded: false, sealNumber: 'SEAL1', chassisNumber: 'SLSZ123456' },
        { id: 'b', number: 'MSCU2222220', isLoaded: true, sealNumber: null },
      ],
    )
    expect(merged.map(item => item.id)).toEqual(['a', 'b'])
    expect(merged[0]?.sealNumber).toBe('SEAL1')
    expect(merged[0]?.chassisNumber).toBe('SLSZ123456')
  })

  it('keeps empty and loaded boxes alike', () => {
    const merged = mergeSiteContainers(
      [{ id: 'empty', isLoaded: false }],
      [{ id: 'load', isLoaded: true }],
    )
    expect(merged.map(item => item.id)).toEqual(['empty', 'load'])
  })
})
