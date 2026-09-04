import { describe, expect, it } from 'vitest'
import { parseCsxPickupList, parseCsxPickupTranscript } from '../shared/utils/csx-list-parse'

describe('CSX pickup list parse', () => {
  it('pairs a two-column line', () => {
    const result = parseCsxPickupTranscript('KOSU 495338  NBDLNQ')
    expect(result.pairs).toEqual([
      { containerNumber: 'KOSU495338', pickupNumber: 'NBDLNQ', confidence: 'high' },
    ])
  })

  it('pairs alternating lines', () => {
    const result = parseCsxPickupList([
      'KOSU495338',
      'NBDLNQ',
      'TCLU1234567',
      'PKP99821',
    ])
    expect(result.pairs.map(pair => pair.containerNumber)).toEqual(['KOSU495338', 'TCLU1234567'])
    expect(result.pairs.every(pair => pair.confidence === 'guess')).toBe(true)
  })

  it('leaves unmatched leftovers', () => {
    const result = parseCsxPickupTranscript('KOSU495338')
    expect(result.pairs).toEqual([])
    expect(result.leftoverContainers).toEqual(['KOSU495338'])
  })
})
