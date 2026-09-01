import { describe, expect, it } from 'vitest'

import {
  dataUrlToFile,
  nextAttachmentSelection,
  nextShareTitle,
  scanShareStem,
} from '../app/utils/trip-share-files'

describe('scanShareStem', () => {
  it('uses the formatted container number when present', () => {
    expect(scanShareStem({ containerNumber: 'BSIU8261271', chassisNumber: 'AIMZ481121' }))
      .toBe('BSIU826127-1')
  })

  it('falls back to the chassis number', () => {
    expect(scanShareStem({ chassisNumber: 'AIMZ481121' })).toBe('AIMZ481121')
  })
})

describe('nextShareTitle', () => {
  it('names a container scan after the box number', () => {
    expect(nextShareTitle('container', [], 'image/jpeg', { containerNumber: 'BSIU8261271' }))
      .toBe('BSIU826127-1.jpg')
  })

  it('names a chassis scan after the chassis number', () => {
    expect(nextShareTitle('chassis', [], 'image/jpeg', { chassisNumber: 'AIMZ481121' }))
      .toBe('AIMZ481121.jpg')
  })

  it('does not collide two different boxes', () => {
    expect(nextShareTitle('container', [{ fileName: 'BSIU826127-1.jpg' }], 'image/jpeg', {
      containerNumber: 'KOSU4968035',
    })).toBe('KOSU496803-5.jpg')
  })

  it('numbers a second scan of the same box', () => {
    expect(nextShareTitle('container', [{ fileName: 'BSIU826127-1.jpg' }], 'image/jpeg', {
      containerNumber: 'BSIU8261271',
    })).toBe('BSIU826127-1 2.jpg')
  })

  it('numbers documents as document 1, 2, 3…', () => {
    expect(nextShareTitle('document', [], 'application/pdf')).toBe('document 1.pdf')
    expect(nextShareTitle('document', [
      { fileName: 'BSIU826127-1.jpg' },
      { fileName: 'document 1.pdf' },
    ], 'image/jpeg')).toBe('document 2.jpg')
  })
})

describe('dataUrlToFile', () => {
  it('turns a JPEG data URL into a named File', async () => {
    const jpeg = 'data:image/jpeg;base64,/9j/4AAQ'
    const file = dataUrlToFile(jpeg, 'container.jpg')
    expect(file.name).toBe('container.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(file.size).toBeGreaterThan(0)
    const bytes = new Uint8Array(await file.arrayBuffer())
    expect(bytes[0]).toBe(0xff)
    expect(bytes[1]).toBe(0xd8)
  })

  it('reads the MIME type from the data URL header', () => {
    const file = dataUrlToFile('data:application/pdf;base64,JVBERi0=', 'gate-ticket.pdf')
    expect(file.type).toBe('application/pdf')
    expect(file.name).toBe('gate-ticket.pdf')
  })
})

describe('nextAttachmentSelection', () => {
  it('selects every file on the first load', () => {
    expect([...nextAttachmentSelection([], [], ['a.jpg', 'b.pdf'])]).toEqual(['a.jpg', 'b.pdf'])
  })

  it('keeps ticks and selects newly added files', () => {
    expect([...nextAttachmentSelection(['a.jpg'], ['a.jpg', 'b.pdf'], ['a.jpg', 'b.pdf', 'c.jpg'])])
      .toEqual(['a.jpg', 'c.jpg'])
  })
})
