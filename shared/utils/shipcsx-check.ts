export const SHIPCSX_CHECK_STEPS = [
  { id: 'open', label: 'Opening ShipCSX' },
  { id: 'terminal', label: 'Selecting terminal' },
  { id: 'equipment', label: 'Typing trailer number' },
  { id: 'reference', label: 'Typing reference' },
  { id: 'search', label: 'Searching' },
  { id: 'results', label: 'Reading results' },
] as const

export type ShipcsxCheckStepId = (typeof SHIPCSX_CHECK_STEPS)[number]['id']

export type ShipcsxCheckStatus = 'running' | 'done' | 'error'

export interface ShipcsxCheckProgress {
  containerId: string
  status: ShipcsxCheckStatus
  stepId: ShipcsxCheckStepId
  stepLabel: string
  stepIndex: number
  stepCount: number
  error: string | null
  startedAt: number
  finishedAt: number | null
}

export function shipcsxCheckStep(id: ShipcsxCheckStepId) {
  const index = SHIPCSX_CHECK_STEPS.findIndex(step => step.id === id)
  const step = SHIPCSX_CHECK_STEPS[index] ?? SHIPCSX_CHECK_STEPS[0]
  return {
    stepId: step.id,
    stepLabel: step.label,
    stepIndex: index + 1,
    stepCount: SHIPCSX_CHECK_STEPS.length,
  }
}

export function shipcsxCheckProgressLine(progress: Pick<ShipcsxCheckProgress, 'stepIndex' | 'stepCount' | 'stepLabel'>): string {
  return `Step ${progress.stepIndex} of ${progress.stepCount} · ${progress.stepLabel}`
}
