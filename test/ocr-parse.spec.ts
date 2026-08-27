import { describe, expect, it } from 'vitest'
import { classifyEquipmentReadings, driverOcrMessage, extractChassisTokens, extractIsoWindows, isTesseractTsv, parseEquipmentReadings, stitchOcrFragments, visibleOcrTranscript } from '../shared/utils/ocr-parse'

describe('extractIsoWindows', () => {
  it('finds a valid number in a noisy transcript', () => {
    expect(extractIsoWindows('MSCU 452189 4')).toEqual(['MSCU4521894'])
  })

  it('finds the number when OCR wraps vertical letters onto separate lines', () => {
    expect(extractIsoWindows('M\nS\nC\nU\n4\n5\n2\n1\n8\n9\n4')).toEqual(['MSCU4521894'])
  })

  it('ignores short fragments', () => {
    expect(extractIsoWindows('MSCU452')).toEqual([])
  })

  it('ignores tesseract TSV headers so they cannot become a fake number', () => {
    const header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
    expect(extractIsoWindows(header)).toEqual([])
    expect(parseEquipmentReadings([header], 'container').map(c => c.value)).toEqual([])
  })

  it('finds a stacked door number when OCR returns one character per line', () => {
    expect(extractIsoWindows('B\nS\nI\nU\n8\n4\n2\n3\n0\n8\n0')).toEqual(['BSIU8423080'])
  })
})

describe('isTesseractTsv', () => {
  it('detects a TSV table dump', () => {
    expect(isTesseractTsv('level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t162\t8\t2\t88\t87\t8')).toBe(true)
    expect(visibleOcrTranscript('5\t1\t1\t1\t1\t1\t162\t8\t2\t88\t87\t8')).toBe('')
  })

  it('does not treat a real reading as TSV', () => {
    expect(isTesseractTsv('B S I U 8 4 2 3 0 8 0')).toBe(false)
    expect(visibleOcrTranscript('B S I U 8 4 2 3 0 8 0')).toContain('B S I U')
  })
})

describe('extractChassisTokens', () => {
  it('keeps a horizontal plate as one token', () => {
    expect(extractChassisTokens('ABCZ 1234567')).toContain('ABCZ1234567')
  })

  it('keeps a non-ISO fleet number', () => {
    expect(extractChassisTokens('TRLR 88421')).toContain('TRLR88421')
  })
})

describe('parseEquipmentReadings', () => {
  it('ranks a check-digit-valid container first', () => {
    const ranked = parseEquipmentReadings(['MSCU4521894 garbage CSQU3054383'], 'container')
    expect(ranked[0]?.value).toBe('MSCU4521894')
    expect(ranked[0]?.checkDigitValid).toBe(true)
  })

  it('offers ISO corrections when the engine reads O for 0', () => {
    const ranked = parseEquipmentReadings(['CSQU3O54383'], 'container')
    expect(ranked.some(c => c.value === 'CSQU3054383' && c.checkDigitValid)).toBe(true)
  })

  it('ignores 11-character garbage that is not an owner-code prefix', () => {
    const ranked = parseEquipmentReadings(['T000NLNTUWV'], 'container')
    expect(ranked.map(c => c.value)).not.toContain('T000NLNTUWV')
  })

  it('returns chassis tokens that are not ISO-shaped', () => {
    const ranked = parseEquipmentReadings(['TRLR88421'], 'chassis')
    expect(ranked.map(c => c.value)).toContain('TRLR88421')
  })
})

describe('classifyEquipmentReadings', () => {
  it('splits a stacked container code from the chassis plate in the same photo', () => {
    const classified = classifyEquipmentReadings([
      'BSIU',
      '816924',
      '7',
      'SUPER HEAVY',
      'AIMZ 481345',
    ])
    expect(classified.container).toBe('BSIU8169247')
    expect(classified.chassis).toBe('AIMZ481345')
  })

  it('does not treat the container serial as a chassis plate', () => {
    const classified = classifyEquipmentReadings(['BSIU 816924 7'])
    expect(classified.container).toBe('BSIU8169247')
    expect(classified.chassis).toBeNull()
  })

  it('joins letter then digit fragments', () => {
    expect(stitchOcrFragments(['BSIU', '8169247'])).toContain('BSIU8169247')
  })
})

describe('driverOcrMessage', () => {
  it('hides Python permission errors from the driver UI', () => {
    expect(driverOcrMessage('[Errno 13] Permission denied: e2e_results/')).toBe(
      'No container number could be read. Frame the four letters and seven digits, then retake.',
    )
  })

  it('keeps a real engine message', () => {
    expect(driverOcrMessage('No text detected.')).toBe('No text detected.')
  })
})
