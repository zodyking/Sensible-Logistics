import type { ContainerType, PickupEquipmentSize, TripKind } from './domain'
import { isCompleteChassisNumber, maskChassisInput, validateContainerNumber } from './iso6346'

export const LOCATION_AUDIT_ACTIONS = ['add', 'move', 'delete'] as const
export type LocationAuditAction = (typeof LOCATION_AUDIT_ACTIONS)[number]

export const LOCATION_AUDIT_ACTION_LABELS: Record<LocationAuditAction, string> = {
  add: 'Add equipment',
  move: 'Move',
  delete: 'Delete',
}

export const LOCATION_AUDIT_ACTION_HINTS: Record<LocationAuditAction, string> = {
  add: 'Boxes and chassis onto this yard, one card at a time',
  move: 'Send boxes from here to another location',
  delete: 'Send boxes to Uncategorized, or remove them there',
}

export const LOCATION_AUDIT_STEPS = [
  'action',
  'equipment',
  'pick',
  'destination',
  'confirm',
] as const
export type LocationAuditStep = (typeof LOCATION_AUDIT_STEPS)[number]

export const LOCATION_AUDIT_MAX = 80

export const AUDIT_EQUIPMENT_STAGES = ['kind', 'numbers', 'classify', 'done'] as const
export type AuditEquipmentStage = (typeof AUDIT_EQUIPMENT_STAGES)[number]

export type LocationAuditEquipmentKind = Extract<TripKind, 'CONTAINER' | 'BARE_CHASSIS'>

/** One-screen-per-question path for the location audit wizard. */
export function locationAuditSteps(action: LocationAuditAction | null): LocationAuditStep[] {
  if (action === 'add') return ['action', 'equipment', 'confirm']
  if (action === 'move') return ['action', 'pick', 'destination', 'confirm']
  if (action === 'delete') return ['action', 'pick', 'confirm']
  return ['action']
}

export type LocationAuditEquipmentDraft = {
  id: string
  stage: AuditEquipmentStage
  kind: LocationAuditEquipmentKind | null
  containerNumber: string
  chassisNumber: string
  containerType: ContainerType | null
  equipmentType: PickupEquipmentSize | null
}

export type LocationAuditAddContainerItem = {
  kind: 'CONTAINER'
  containerNumber: string
  chassisNumber?: string | null
  containerType: ContainerType
  equipmentType: PickupEquipmentSize
}

export type LocationAuditAddChassisItem = {
  kind: 'BARE_CHASSIS'
  chassisNumber: string
}

export type LocationAuditAddItem = LocationAuditAddContainerItem | LocationAuditAddChassisItem

export function createAuditEquipmentDraft(
  kind: LocationAuditEquipmentKind | null = null,
): LocationAuditEquipmentDraft {
  return {
    id: crypto.randomUUID(),
    stage: kind ? 'numbers' : 'kind',
    kind,
    containerNumber: '',
    chassisNumber: '',
    containerType: null,
    equipmentType: null,
  }
}

export function auditCardNumbersReady(draft: LocationAuditEquipmentDraft): boolean {
  if (draft.kind === 'BARE_CHASSIS') return isCompleteChassisNumber(draft.chassisNumber)
  if (draft.kind !== 'CONTAINER') return false
  const validation = validateContainerNumber(draft.containerNumber)
  if (!validation.structureValid || !validation.normalized) return false
  if (draft.chassisNumber && !isCompleteChassisNumber(draft.chassisNumber)) return false
  return true
}

export function auditCardClassifyReady(draft: LocationAuditEquipmentDraft): boolean {
  return draft.kind === 'CONTAINER' && Boolean(draft.containerType && draft.equipmentType)
}

export function auditCardTitle(draft: LocationAuditEquipmentDraft): string {
  if (draft.stage === 'numbers') return draft.kind === 'BARE_CHASSIS' ? 'Chassis' : 'Numbers'
  if (draft.stage === 'classify') return 'Type and size'
  if (draft.stage === 'done') return draft.kind === 'BARE_CHASSIS' ? 'Chassis' : 'Container'
  return 'Equipment'
}

export function auditCardBackStage(draft: LocationAuditEquipmentDraft): AuditEquipmentStage | null {
  if (draft.stage === 'numbers') return 'kind'
  if (draft.stage === 'classify') return 'numbers'
  if (draft.stage === 'done') return draft.kind === 'BARE_CHASSIS' ? 'numbers' : 'classify'
  return null
}

export function auditCardNextStage(draft: LocationAuditEquipmentDraft): AuditEquipmentStage | null {
  if (draft.stage === 'kind' && draft.kind) return 'numbers'
  if (draft.stage === 'numbers' && auditCardNumbersReady(draft)) {
    return draft.kind === 'CONTAINER' ? 'classify' : 'done'
  }
  if (draft.stage === 'classify' && auditCardClassifyReady(draft)) return 'done'
  return null
}

export function auditEquipmentItemFromDraft(
  draft: LocationAuditEquipmentDraft,
): LocationAuditAddItem | null {
  if (draft.kind === 'BARE_CHASSIS') {
    if (!isCompleteChassisNumber(draft.chassisNumber)) return null
    return {
      kind: 'BARE_CHASSIS',
      chassisNumber: maskChassisInput(draft.chassisNumber),
    }
  }
  if (draft.kind !== 'CONTAINER') return null
  const validation = validateContainerNumber(draft.containerNumber)
  if (!validation.structureValid || !validation.normalized) return null
  if (draft.chassisNumber && !isCompleteChassisNumber(draft.chassisNumber)) return null
  if (!draft.containerType || !draft.equipmentType) return null
  return {
    kind: 'CONTAINER',
    containerNumber: validation.normalized,
    chassisNumber: draft.chassisNumber ? maskChassisInput(draft.chassisNumber) : null,
    containerType: draft.containerType,
    equipmentType: draft.equipmentType,
  }
}

export function auditEquipmentIdentityKey(draft: LocationAuditEquipmentDraft): string | null {
  if (draft.kind === 'BARE_CHASSIS') {
    return isCompleteChassisNumber(draft.chassisNumber)
      ? `CH:${maskChassisInput(draft.chassisNumber)}`
      : null
  }
  const validation = validateContainerNumber(draft.containerNumber)
  return validation.normalized ? `CT:${validation.normalized}` : null
}

export function auditAddItemIdentityKey(item: LocationAuditAddItem): string {
  return item.kind === 'BARE_CHASSIS'
    ? `CH:${maskChassisInput(item.chassisNumber)}`
    : `CT:${item.containerNumber}`
}

export function auditAddItemLabel(item: LocationAuditAddItem): string {
  return item.kind === 'BARE_CHASSIS' ? item.chassisNumber : item.containerNumber
}

export function readyAuditAddItems(drafts: LocationAuditEquipmentDraft[]): LocationAuditAddItem[] {
  const items: LocationAuditAddItem[] = []
  const seen = new Set<string>()
  for (const draft of drafts) {
    const item = auditEquipmentItemFromDraft(draft)
    if (!item) continue
    const key = auditAddItemIdentityKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    items.push(item)
    if (items.length >= LOCATION_AUDIT_MAX) break
  }
  return items
}
