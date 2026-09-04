import type { ShipcsxCheckProgress, ShipcsxCheckStepId } from '#shared/utils/shipcsx-check'
import { shipcsxCheckStep } from '#shared/utils/shipcsx-check'

const DONE_TTL_MS = 2 * 60 * 1000

const jobs = new Map<string, ShipcsxCheckProgress>()

export function getShipcsxCheckJob(containerId: string): ShipcsxCheckProgress | null {
  const job = jobs.get(containerId)
  if (!job) return null
  if (job.status !== 'running' && job.finishedAt && Date.now() - job.finishedAt > DONE_TTL_MS) {
    jobs.delete(containerId)
    return null
  }
  return job
}

export function beginShipcsxCheckJob(containerId: string): ShipcsxCheckProgress {
  const existing = getShipcsxCheckJob(containerId)
  if (existing?.status === 'running') return existing
  const step = shipcsxCheckStep('open')
  const job: ShipcsxCheckProgress = {
    containerId,
    status: 'running',
    ...step,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  }
  jobs.set(containerId, job)
  return job
}

export function setShipcsxCheckStep(containerId: string, stepId: ShipcsxCheckStepId) {
  const job = jobs.get(containerId)
  if (!job || job.status !== 'running') return
  Object.assign(job, shipcsxCheckStep(stepId))
}

export function finishShipcsxCheckJob(containerId: string, error?: string | null) {
  const job = jobs.get(containerId)
  if (!job) return
  job.status = error ? 'error' : 'done'
  job.error = error ?? null
  job.finishedAt = Date.now()
}
