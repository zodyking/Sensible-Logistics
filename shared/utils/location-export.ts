import {
  CONTAINER_TYPE_LABELS,
  EQUIPMENT_TYPES,
  pickupEquipmentSizeLabel,
  type ContainerType,
  type EquipmentType,
} from './domain'
import { maskChassisInput, maskContainerInput } from './iso6346'

/** Capital-cased steamship names for the pasted list. CMA matches the line as CMA CGM. */
const EXPORT_TYPE_LABELS: Record<ContainerType, string> = {
  TROPICAL: 'Tropical',
  ZIM: 'ZIM',
  CMA: 'CMA CGM',
  KING_OCEAN: 'King Ocean',
}

export type LocationExportContainer = {
  number: string
  containerType?: ContainerType | string | null
  equipmentType?: EquipmentType | string | null
  chassisNumber?: string | null
}

export type LocationExportChassis = {
  number: string
}

const CONTAINER_TITLE = 'Containers'
const BARE_TITLE = 'Bare Chassis'

/** First letter up, remainder lower — for section titles. */
export function toSentenceCase(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const lower = trimmed.toLocaleLowerCase()
  return lower.charAt(0).toLocaleUpperCase() + lower.slice(1)
}

/** Title-case each word. Short all-caps tokens (ZIM, CMA, CT) stay intact. */
export function toCapitalCase(value: string): string {
  return value
    .trim()
    .split(/\s+/g)
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9]{2,}$/.test(word) && word === word.toUpperCase()) return word
      return word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase()
    })
    .join(' ')
}

function formatExportContainer(input: string): string {
  return maskContainerInput(input) || input.trim().toUpperCase()
}

/** Painted plate with a space after the owner block: `TRAC 123456`. */
export function formatExportChassis(input: string): string {
  const raw = input.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!raw) return ''
  if (/\s/.test(raw)) return raw
  const compact = maskChassisInput(raw)
  const letters = compact.replace(/\d/g, '')
  const digits = compact.slice(letters.length)
  if (letters && digits) return `${letters} ${digits}`
  return raw
}

function chassisKey(input: string | null | undefined): string {
  return maskChassisInput(input ?? '') || (input ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function typeName(type: string | null | undefined): string | null {
  if (!type) return null
  if (type in EXPORT_TYPE_LABELS) return EXPORT_TYPE_LABELS[type as ContainerType]
  if (type in CONTAINER_TYPE_LABELS) return CONTAINER_TYPE_LABELS[type as ContainerType]
  return toCapitalCase(type.replace(/_/g, ' '))
}

function sizeLabel(type: string | null | undefined): string | null {
  if (!type) return null
  if ((EQUIPMENT_TYPES as readonly string[]).includes(type)) {
    return pickupEquipmentSizeLabel(type as EquipmentType)
  }
  return null
}

function typeEntry(item: LocationExportContainer): string | null {
  const type = typeName(item.containerType ?? null)
  if (!type) return null
  const size = sizeLabel(item.equipmentType ?? null)
  return size ? `${size} ${type}` : type
}

function numberedBlock(index: number, lines: string[]): string {
  const prefix = `${index}. `
  const indent = ' '.repeat(prefix.length)
  return lines.map((line, i) => (i === 0 ? `${prefix}${line}` : `${indent}${line}`)).join('\n')
}

function comboLines(item: LocationExportContainer): string[] | null {
  const number = formatExportContainer(item.number)
  if (!number) return null
  const lines = [`CT: ${number}`]
  const chassis = item.chassisNumber?.trim() ? formatExportChassis(item.chassisNumber) : ''
  if (chassis) lines.push(`${toCapitalCase('chassis')}: ${chassis}`)
  const type = typeEntry(item)
  if (type) lines.push(type)
  return lines
}

function comboSection(containers: readonly LocationExportContainer[]): string | null {
  const blocks: string[] = []
  for (const item of containers) {
    const lines = comboLines(item)
    if (!lines) continue
    blocks.push(numberedBlock(blocks.length + 1, lines))
  }
  if (!blocks.length) return null
  return `${CONTAINER_TITLE}\n\n${blocks.join('\n\n')}`
}

function bareSection(
  chassis: readonly LocationExportChassis[],
  occupiedKeys: Set<string>,
): string | null {
  const blocks: string[] = []
  for (const item of chassis) {
    const key = chassisKey(item.number)
    if (key && occupiedKeys.has(key)) continue
    const number = formatExportChassis(item.number)
    if (!number) continue
    blocks.push(numberedBlock(blocks.length + 1, [`${toCapitalCase('chassis')}: ${number}`]))
  }
  if (!blocks.length) return null
  return `${BARE_TITLE}\n\n${blocks.join('\n')}`
}

/**
 * Share text for a location: containers first, then bare chassis.
 * Empty sections are omitted. Container units are separated by a blank line.
 */
export function formatLocationExportList(input: {
  locationName: string
  containers?: readonly LocationExportContainer[] | null
  chassis?: readonly LocationExportChassis[] | null
}): string {
  const name = input.locationName.trim()
  const containers = input.containers ?? []
  const occupied = new Set(
    containers
      .map(item => chassisKey(item.chassisNumber))
      .filter(Boolean),
  )
  const parts: string[] = []
  if (name) parts.push(name)
  const combos = comboSection(containers)
  if (combos) parts.push(combos)
  const bare = bareSection(input.chassis ?? [], occupied)
  if (bare) parts.push(bare)
  return parts.join('\n\n')
}
