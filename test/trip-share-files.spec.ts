import { describe, expect, it } from 'vitest'

import { dataUrlToFile, nextShareTitle, nextAttachmentSelection } from '../app/utils/trip-share-files'

describe('nextShareTitle', () => {
  it('numbers container images from 1', () => {
    expect(nextShareTitle('container', [], 'image/jpeg')).toBe('container image 1.jpg')
    expect(nextShareTitle('container', [{ fileName: 'container image 1.jpg' }], 'image/jpeg'))
      .toBe('container image 2.jpg')
  })

  it('numbers document images separately', () => {
    expect(nextShareTitle('document', [
      { fileName: 'container image 1.jpg' },
      { fileName: 'document image 1.pdf' },
    ], 'image/jpeg')).toBe('document image 2.jpg')
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
