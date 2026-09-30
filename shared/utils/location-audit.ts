import { validateContainerNumber } from './iso6346'

export const LOCATION_AUDIT_ACTIONS = ['add', 'move', 'delete'] as const
export type LocationAuditAction = (typeof LOCATION_AUDIT_ACTIONS)[number]

export const LOCATION_AUDIT_ACTION_LABELS: Record<LocationAuditAction, string> = {
  add: 'Add containers',
  move: 'Move',
  delete: 'Delete',
}

export const LOCATION_AUDIT_ACTION_HINTS: Record<LocationAuditAction, string> = {
  add: 'Paste many box numbers onto this yard',
  move: 'Send boxes from here to another location',
  delete: 'Remove boxes from the company pool',
}

export const LOCATION_AUDIT_STEPS = [
  'action',
  'numbers',
  'containerType',
  'equipmentType',
  'pick',
  'destination',
  'confirm',
] as const
export type LocationAuditStep = (typeof LOCATION_AUDIT_STEPS)[number]

export const LOCATION_AUDIT_MAX = 80

/** One-screen-per-question path for the location audit wizard. */
export function locationAuditSteps(action: LocationAuditAction | null): LocationAuditStep[] {
  if (action === 'add') return ['action', 'numbers', 'containerType', 'equipmentType', 'confirm']
  if (action === 'move') return ['action', 'pick', 'destination', 'confirm']
  if (action === 'delete') return ['action', 'pick', 'confirm']
  return ['action']
}

export type BulkContainerParse = {
  numbers: string[]
  invalid: string[]
}

/**
 * Split pasted yard lists on whitespace, commas, or semicolons. Keep unique
 * ISO-structured markings (owner + serial + check digit).
 */
export function parseBulkContainerNumbers(raw: string): BulkContainerParse {
  const tokens = (raw ?? '').split(/[\s,;]+/).map(token => token.trim()).filter(Boolean)
  const numbers: string[] = []
  const seen = new Set<string>()
  const invalid: string[] = []
  const invalidSeen = new Set<string>()

  for (const token of tokens) {
    const validation = validateContainerNumber(token)
    if (!validation.structureValid || !validation.normalized) {
      const label = token.toUpperCase()
      if (!invalidSeen.has(label)) {
        invalidSeen.add(label)
        invalid.push(label)
      }
      continue
    }
    if (seen.has(validation.normalized)) continue
    seen.add(validation.normalized)
    numbers.push(validation.normalized)
    if (numbers.length >= LOCATION_AUDIT_MAX) break
  }

  return { numbers, invalid }
}
