import { randomBytes } from 'node:crypto'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

/** Unambiguous 12-character password, grouped for reading aloud. */
export function generateTemporaryPassword(): string {
  const bytes = randomBytes(12)
  let raw = ''
  for (const byte of bytes) raw += ALPHABET[byte % ALPHABET.length]
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}
