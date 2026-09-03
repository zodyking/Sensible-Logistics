/**
 * Tasks belong to the calendar day they were added. Stored `workDate` may
 * still be a leftover “tomorrow” parse; `receivedAt` is the source of truth.
 */

import type { TaskStep } from './task-steps'
import { toLocalIsoDate } from './trip-days'

export function taskAddedDate(task: {
  receivedAt?: string | number | Date | null
  workDate: string
}): string {
  return toLocalIsoDate(task.receivedAt) ?? task.workDate
}

/**
 * Order: today, then upcoming (soonest first), then earlier (newest first).
 */
export function groupTasksByWorkDate<T extends {
  workDate: string
  status: string
  receivedAt?: string | number | Date | null
}>(
  tasks: readonly T[],
  todayIso: string,
): Array<{ iso: string, tasks: T[] }> {
  const map = new Map<string, T[]>()
  if (todayIso) map.set(todayIso, [])

  for (const task of tasks) {
    if (task.status === 'DISMISSED') continue
    const iso = taskAddedDate(task)
    const list = map.get(iso) ?? []
    list.push(task)
    map.set(iso, list)
  }

  const keys = [...map.keys()]
  const upcoming = keys.filter(iso => iso > todayIso).sort((a, b) => a.localeCompare(b))
  const earlier = keys.filter(iso => iso < todayIso).sort((a, b) => b.localeCompare(a))
  const order = todayIso
    ? [todayIso, ...upcoming, ...earlier]
    : keys.sort((a, b) => b.localeCompare(a))

  return order
    .filter((iso, index) => map.has(iso) && order.indexOf(iso) === index)
    .map(iso => ({ iso, tasks: map.get(iso) ?? [] }))
}

export interface DayWorkTask {
  id: string
  title: string
  rawText: string
  sender?: string | null
  receivedAt: string | number | Date
  workDate: string
  status: string
  steps?: Array<{ id: string, text: string, done: boolean }>
}

/** Flatten every work instruction for a day into one pull list. */
export function concatenateDayWork(tasks: readonly DayWorkTask[]): TaskStep[] {
  const steps: TaskStep[] = []
  for (const task of tasks) {
    if (task.steps?.length) {
      for (const step of task.steps) {
        steps.push({ id: step.id, text: step.text, done: step.done })
      }
      continue
    }
    const text = task.rawText.trim()
    if (text) {
      steps.push({
        id: task.id,
        text,
        done: task.status === 'DONE',
      })
    }
  }
  return steps
}
