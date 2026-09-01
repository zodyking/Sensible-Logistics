import { describe, expect, it } from 'vitest'

import { groupTasksByWorkDate, taskAddedDate } from '../shared/utils/task-days'

describe('taskAddedDate', () => {
  it('uses receivedAt, not a leftover tomorrow workDate', () => {
    expect(taskAddedDate({
      workDate: '2026-09-02',
      receivedAt: '2026-09-01T12:00:00.000Z',
    })).toBe('2026-09-01')
  })

  it('falls back to workDate when receivedAt is missing', () => {
    expect(taskAddedDate({ workDate: '2026-09-01' })).toBe('2026-09-01')
  })
})

describe('groupTasksByWorkDate', () => {
  it('always includes today, even with no tasks', () => {
    expect(groupTasksByWorkDate([], '2026-09-01')).toEqual([
      { iso: '2026-09-01', tasks: [] },
    ])
  })

  it('files visible tasks under the day they were added, today then earlier', () => {
    const monday = { workDate: '2026-09-01', receivedAt: '2026-08-31T12:00:00.000Z', status: 'OPEN' as const, id: 'a' }
    const tuesday = { workDate: '2026-09-02', receivedAt: '2026-09-01T12:00:00.000Z', status: 'DONE' as const, id: 'b' }
    const dismissed = { workDate: '2026-09-01', receivedAt: '2026-09-01T12:00:00.000Z', status: 'DISMISSED' as const, id: 'c' }

    const groups = groupTasksByWorkDate([monday, tuesday, dismissed], '2026-09-01')
    expect(groups.map(group => group.iso)).toEqual(['2026-09-01', '2026-08-31'])
    expect(groups[0]!.tasks.map(task => task.id)).toEqual(['b'])
    expect(groups[1]!.tasks.map(task => task.id)).toEqual(['a'])
  })

  it('keeps today first, then upcoming, then earlier', () => {
    const later = { workDate: '2026-09-02', receivedAt: '2026-09-02T12:00:00.000Z', status: 'OPEN' as const, id: 'd' }
    const earlier = { workDate: '2026-08-30', receivedAt: '2026-08-30T12:00:00.000Z', status: 'DONE' as const, id: 'e' }
    const groups = groupTasksByWorkDate([later, earlier], '2026-09-01')
    expect(groups.map(group => group.iso)).toEqual(['2026-09-01', '2026-09-02', '2026-08-30'])
    expect(groups[0]).toEqual({ iso: '2026-09-01', tasks: [] })
  })
})
