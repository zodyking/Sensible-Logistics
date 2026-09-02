import {
  formatChassisNumber,
  formatContainerNumber,
  maskChassisInput,
  maskContainerInput,
} from './iso6346'

export type EquipmentCopyKind = 'container' | 'chassis' | 'seal'

export type EquipmentCopyPart = {
  key: 'full' | 'bic' | 'serial' | 'letters' | 'digits'
  /** ISO / industry label shown in the copy menu. */
  label: string
  value: string
}

function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '')
}

function lettersOnly(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '')
}

function uniqueParts(parts: EquipmentCopyPart[]): EquipmentCopyPart[] {
  const seen = new Set<string>()
  const out: EquipmentCopyPart[] = []
  for (const part of parts) {
    if (!part.value || seen.has(part.value)) continue
    seen.add(part.value)
    out.push(part)
  }
  return out
}

/**
 * Container (ISO 6346): Full marking, BIC prefix (owner code + category),
 * and serial number (six digits before the check-digit dash).
 */
export function containerCopyParts(input: string | null | undefined): EquipmentCopyPart[] {
  const compact = maskContainerInput(input ?? '')
  if (!compact) return []
  const letters = compact.replace(/\d/g, '')
  const digits = compact.slice(letters.length)
  return uniqueParts([
    { key: 'full', label: 'Full', value: formatContainerNumber(compact) || compact },
    { key: 'bic', label: 'BIC', value: letters },
    { key: 'serial', label: 'Serial', value: digits.slice(0, 6) },
  ])
}

/**
 * Chassis plate: Full marking, four-letter prefix (same BIC-style owner
 * block), and the six-digit serial.
 */
export function chassisCopyParts(input: string | null | undefined): EquipmentCopyPart[] {
  const compact = maskChassisInput(input ?? '')
  if (!compact) return []
  const letters = compact.replace(/\d/g, '')
  const serial = compact.slice(letters.length)
  return uniqueParts([
    { key: 'full', label: 'Full', value: formatChassisNumber(compact) || compact },
    { key: 'bic', label: 'BIC', value: letters },
    { key: 'serial', label: 'Serial', value: serial },
  ])
}

/**
 * Seal: Full string, letters only, and digits only.
 */
export function sealCopyParts(input: string | null | undefined): EquipmentCopyPart[] {
  const raw = (input ?? '').trim()
  if (!raw) return []
  return uniqueParts([
    { key: 'full', label: 'Full', value: raw },
    { key: 'letters', label: 'Letters', value: lettersOnly(raw) },
    { key: 'digits', label: 'Digits', value: digitsOnly(raw) },
  ])
}

export function equipmentCopyParts(
  kind: EquipmentCopyKind,
  input: string | null | undefined,
): EquipmentCopyPart[] {
  if (kind === 'container') return containerCopyParts(input)
  if (kind === 'chassis') return chassisCopyParts(input)
  return sealCopyParts(input)
}
