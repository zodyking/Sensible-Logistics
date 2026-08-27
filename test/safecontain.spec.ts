import { describe, expect, it } from 'vitest'
import { SAFECONTAIN_ENGINE, SAFECONTAIN_TESSDATA_URL, defaultTessdataDir } from '../server/services/safecontain'

describe('SAFEContain tessdata', () => {
  it('points at the upstream trained English model', () => {
    expect(SAFECONTAIN_ENGINE).toBe('safecontain')
    expect(SAFECONTAIN_TESSDATA_URL).toContain('m-fol/SAFEContain')
    expect(SAFECONTAIN_TESSDATA_URL).toContain('tessdata/eng.traineddata')
  })

  it('caches the model in a writable temp dir by default', () => {
    expect(defaultTessdataDir()).toContain('safecontain')
    expect(defaultTessdataDir()).toContain('tessdata')
  })
})
