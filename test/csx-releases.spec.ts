import { describe, expect, it } from 'vitest'
import { claimCsxRelease, confirmCsxRelease, csxInventoryId, parseCsxInventoryId, reopenCsxRelease } from '../shared/utils/csx-releases'

describe('CSX release lifecycle', () => {
  it('claims an open release and confirms from either open or claimed', () => {
    expect(claimCsxRelease('OPEN')).toBe('CLAIMED')
    expect(claimCsxRelease('CLAIMED')).toBeNull()
    expect(confirmCsxRelease('OPEN')).toBe('PICKED_UP')
    expect(confirmCsxRelease('CLAIMED')).toBe('PICKED_UP')
    expect(confirmCsxRelease('PICKED_UP')).toBeNull()
  })

  it('reopens a claimed release after cancel, not a picked-up one', () => {
    expect(reopenCsxRelease('CLAIMED')).toBe('OPEN')
    expect(reopenCsxRelease('PICKED_UP')).toBeNull()
    expect(reopenCsxRelease('OPEN')).toBeNull()
  })

  it('uses a synthetic inventory id when the box is not in the pool', () => {
    expect(csxInventoryId('abc')).toBe('csx:abc')
    expect(parseCsxInventoryId('csx:abc')).toBe('abc')
    expect(parseCsxInventoryId('real-id')).toBeNull()
  })
})
