/** Same-origin binary download that does not parse the body as JSON. */
export async function fetchBinaryFile(url: string, accept: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: accept },
  })
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (response.ok && bytes.byteLength > 4) return bytes

  let message = `Could not download the file (${response.status}).`
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes)) as { statusMessage?: string, message?: string }
    message = json.statusMessage || json.message || message
  }
  catch {
    // HTML error page from Nitro
  }
  throw new Error(message)
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

export function isDocxBytes(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4B
}
