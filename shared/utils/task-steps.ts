/**
 * Checklist steps for a dispatch task. A pasted blob stays one step until
 * the driver splits it. Merge joins two steps back together.
 */

export interface TaskStep {
  id: string
  text: string
  done: boolean
}

function newStepId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `s-${Math.random().toString(36).slice(2, 12)}`
}

export function emptyStep(text = ''): TaskStep {
  return { id: newStepId(), text, done: false }
}

/** Strip list markers so pasted 1. / - lines become plain step text. */
export function cleanStepText(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/^\s*(?:[-*•]+|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Keep the pasted dispatcher text as a single step. Drivers split it by hand. */
export function stepsFromBlob(text: string): TaskStep[] {
  const blob = text.replace(/\r\n/g, '\n').trim()
  if (!blob) return []
  return [emptyStep(blob)]
}

/** Break one step into one step per non-empty line. */
export function splitStepLines(steps: TaskStep[], index: number): TaskStep[] {
  const step = steps[index]
  if (!step) return steps
  const lines = step.text.replace(/\r\n/g, '\n').split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.length <= 1) return steps
  const next = steps.slice()
  next.splice(index, 1, ...lines.map((line, offset) => (
    offset === 0 ? { ...step, text: line } : emptyStep(line)
  )))
  return next
}

export function normalizeSteps(value: unknown): TaskStep[] {
  if (!Array.isArray(value)) return []
  const steps: TaskStep[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as { id?: unknown, text?: unknown, done?: unknown }
    const text = typeof row.text === 'string' ? row.text : ''
    const id = typeof row.id === 'string' && row.id ? row.id : ''
    // Keep blank editor rows (they have ids) so Add step can persist.
    if (!text.trim() && row.done !== true && !id) continue
    steps.push({
      id: id || newStepId(),
      text: text.trim(),
      done: row.done === true,
    })
  }
  return steps
}

export function stepsOrBlob(parsed: Record<string, unknown> | null | undefined, rawText: string): TaskStep[] {
  const fromParsed = normalizeSteps(parsed?.steps)
  if (fromParsed.length) return fromParsed
  return stepsFromBlob(rawText)
}

export function splitStepAt(steps: TaskStep[], index: number, caret: number): TaskStep[] {
  const step = steps[index]
  if (!step) return steps
  const pos = Math.max(0, Math.min(caret, step.text.length))
  const left = step.text.slice(0, pos).trimEnd()
  const right = step.text.slice(pos).trimStart()
  const next = steps.slice()
  next[index] = { ...step, text: left }
  next.splice(index + 1, 0, emptyStep(right))
  return next
}

export function mergeWithPrevious(steps: TaskStep[], index: number): { steps: TaskStep[], caret: number } | null {
  if (index <= 0) return null
  const prev = steps[index - 1]
  const curr = steps[index]
  if (!prev || !curr) return null
  const joiner = prev.text && curr.text ? ' ' : ''
  const caret = prev.text.length + (joiner ? joiner.length : 0)
  const merged: TaskStep = {
    ...prev,
    text: `${prev.text}${joiner}${curr.text}`,
    done: prev.done && curr.done,
  }
  const next = steps.slice()
  next.splice(index - 1, 2, merged)
  return { steps: next, caret }
}

export function allStepsDone(steps: TaskStep[]): boolean {
  return steps.length > 0 && steps.every(step => step.done)
}

export function someStepsDone(steps: TaskStep[]): boolean {
  return steps.some(step => step.done) && !allStepsDone(steps)
}

export function firstLineTitle(text: string, fallback = 'Today’s work'): string {
  const line = text.replace(/\r\n/g, '\n').split('\n').map(cleanStepText).find(Boolean)
  if (!line) return fallback
  return line.length <= 72 ? line : `${line.slice(0, 69)}…`
}
