/**
 * Dispatch SMS → task parsing.
 *
 * Boss texts land here after iPhone Shortcuts or Android automation POST them
 * to the driver's webhook. Only messages that look like work are stored; a
 * dedicated setup phrase proves the forwarder is wired without creating a task.
 */

import type { DispatchTaskKind } from './domain'
import { DISPATCH_TASK_KIND_LABELS } from './domain'

export const SETUP_TEST_PHRASE = 'Sensible setup test'

const TOMORROW_RE = /\b(?:tom+or+ows?|tmrw|tmr)\b/i
const WORK_FOR_TODAY_RE = /\bwork\s+for\s+today\b/i
const WORK_FOR_RE = /\bwork\s+for\b/i
const PICKUP_RE = /\bpick[\s-]*ups?\b/i
const DROPOFF_RE = /\bdrop[\s-]*offs?\b|\bdeliver(?:y|ies|ing)?\b/i
const LIVE_LOAD_RE = /\blive\s*loads?\b/i
const EMPTY_RE = /\bempt(?:y|ies|ied)\b/i
const LOAD_RE = /\bloads?\b/i
const SETUP_TEST_RE = /sensible\s+setup\s+test/i
const TEST_WEBHOOK_RE = /^\s*test\s+webhook\s*$/i

const DISPATCH_HINTS = [
  WORK_FOR_RE,
  PICKUP_RE,
  DROPOFF_RE,
  LIVE_LOAD_RE,
  EMPTY_RE,
  /\bchassis\b/i,
  /\bcontainers?\b/i,
  /\byard\b/i,
  /\bterminal\b/i,
  /\bdray\b/i,
  /\bdrop[\s-]*off\b/i,
]

const ISO_CANDIDATE_RE = /\b([A-Za-z]{4}\s?\d{6,7})\b/g

export interface ParsedDispatchSms {
  kind: DispatchTaskKind
  title: string
  workDate: string
  containerNumbers: string[]
}

/** Calendar day `YYYY-MM-DD` in an IANA timezone. */
export function calendarDateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  if (!year || !month || !day) return date.toISOString().slice(0, 10)
  return `${year}-${month}-${day}`
}

/** Shift a timezone-free ISO date by whole calendar days. */
export function addIsoDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function isSetupTestMessage(text: string): boolean {
  const trimmed = text.trim()
  return SETUP_TEST_RE.test(trimmed) || TEST_WEBHOOK_RE.test(trimmed)
}

export function isDispatchMessage(text: string): boolean {
  if (!text.trim() || isSetupTestMessage(text)) return false
  return DISPATCH_HINTS.some(hint => hint.test(text))
}

export function taskFingerprintSource(text: string, workDate: string): string {
  return `${workDate}\n${text.replace(/\s+/g, ' ').trim().toLowerCase()}`
}

function shortDateLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, month! - 1, day!)))
}

/** Work files on the calendar day it was added, not “tomorrow” or a weekday in the text. */
export function resolveWorkDate(_text: string, todayIso: string): string {
  return todayIso
}

export function classifyDispatchKind(text: string): DispatchTaskKind {
  const pickup = PICKUP_RE.test(text)
  const dropoff = DROPOFF_RE.test(text)
  const empty = EMPTY_RE.test(text)
  const liveLoad = LIVE_LOAD_RE.test(text)
  const load = liveLoad || LOAD_RE.test(text)
  const work = WORK_FOR_RE.test(text)
  const hits = [pickup, dropoff, empty, liveLoad].filter(Boolean).length

  if (hits > 1 || (work && hits >= 1)) return 'WORK'
  if (pickup) return 'PICKUP'
  if (dropoff) return 'DROPOFF'
  if (empty) return 'EMPTY'
  if (liveLoad || (load && !work)) return liveLoad ? 'LOAD' : 'NOTE'
  if (work) return 'WORK'
  return 'NOTE'
}

function extractContainerNumbers(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(ISO_CANDIDATE_RE)) {
    const compact = match[1]!.replace(/\s+/g, '').toUpperCase()
    if (/^[A-Z]{4}\d{6,7}$/.test(compact)) found.add(compact)
  }
  return [...found]
}

export function dispatchTaskTitle(text: string, kind: DispatchTaskKind, workDate: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (TOMORROW_RE.test(text) && WORK_FOR_RE.test(text)) {
    return `Work for ${shortDateLabel(workDate)}`
  }
  if (WORK_FOR_TODAY_RE.test(text)) return 'Work for today'
  if (compact.length <= 72) return compact || DISPATCH_TASK_KIND_LABELS[kind]
  return `${compact.slice(0, 69)}…`
}

export function parseDispatchSms(text: string, todayIso: string): ParsedDispatchSms | null {
  if (!isDispatchMessage(text)) return null
  const workDate = resolveWorkDate(text, todayIso)
  const kind = classifyDispatchKind(text)
  return {
    kind,
    title: dispatchTaskTitle(text, kind, workDate),
    workDate,
    containerNumbers: extractContainerNumbers(text),
  }
}
