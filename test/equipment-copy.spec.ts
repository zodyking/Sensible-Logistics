import { describe, expect, it } from 'vitest'
import {
  chassisCopyParts,
  containerCopyParts,
  sealCopyParts,
} from '../shared/utils/equipment-copy'

describe('containerCopyParts', () => {
  it('splits a painted ISO marking into Full, BIC, and Serial', () => {
    expect(containerCopyParts('MSCU4521894')).toEqual([
      { key: 'full', label: 'Full', value: 'MSCU452189-4' },
      { key: 'bic', label: 'BIC', value: 'MSCU' },
      { key: 'serial', label: 'Serial', value: '452189' },
    ])
  })

  it('reads the serial from the digits before the check-digit dash', () => {
    expect(containerCopyParts('TCLU 123456-7').find(part => part.key === 'serial')?.value).toBe('123456')
  })

  it('returns nothing for an empty value', () => {
    expect(containerCopyParts('')).toEqual([])
    expect(containerCopyParts(null)).toEqual([])
  })
})

describe('chassisCopyParts', () => {
  it('splits a plate into Full, BIC, and Serial', () => {
    expect(chassisCopyParts('SLSZ123456')).toEqual([
      { key: 'full', label: 'Full', value: 'SLSZ123456' },
      { key: 'bic', label: 'BIC', value: 'SLSZ' },
      { key: 'serial', label: 'Serial', value: '123456' },
    ])
  })
})

describe('sealCopyParts', () => {
  it('keeps a mixed seal together and splits letters from digits', () => {
    expect(sealCopyParts('AB12-99')).toEqual([
      { key: 'full', label: 'Full', value: 'AB12-99' },
      { key: 'letters', label: 'Letters', value: 'AB' },
      { key: 'digits', label: 'Digits', value: '1299' },
    ])
  })

  it('splits a dashed seal into letters and the digit run', () => {
    expect(sealCopyParts('SEAL-998877')).toEqual([
      { key: 'full', label: 'Full', value: 'SEAL-998877' },
      { key: 'letters', label: 'Letters', value: 'SEAL' },
      { key: 'digits', label: 'Digits', value: '998877' },
    ])
  })

  it('does not repeat Full when the seal is digits only', () => {
    expect(sealCopyParts('889100')).toEqual([
      { key: 'full', label: 'Full', value: '889100' },
    ])
  })
})
