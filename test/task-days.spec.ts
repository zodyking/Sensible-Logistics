import { describe, expect, it } from 'vitest'

import { groupTasksByWorkDate } from '../shared/utils/task-days'

describe('groupTasksByWorkDate', () => {
  it('always includes today, even with no tasks', () => {
    expect(groupTasksByWorkDate([], '2026-09-01')).toEqual([
      { iso: '2026-09-01', tasks: [] },
    ])
  })

  it('files visible tasks under their work date, today then earlier', () => {
    const monday = { workDate: '2026-08-31', status: 'OPEN' as const, id: 'a' }
    const tuesday = { workDate: '2026-09-01', status: 'DONE' as const, id: 'b' }
    const dismissed = { workDate: '2026-09-01', status: 'DISMISSED' as const, id: 'c' }

    expect(groupTasksByWorkDate([monday, tuesday, dismissed], '2026-09-01')).toEqual([
      { iso: '2026-09-01', tasks: [tuesday] },
      { iso: '2026-08-31', tasks: [monday] },
    ])
  })

  it('keeps today first, then upcoming, then earlier', () => {
    const later = { workDate: '2026-09-02', status: 'OPEN' as const, id: 'd' }
    const earlier = { workDate: '2026-08-30', status: 'DONE' as const, id: 'e' }
    const groups = groupTasksByWorkDate([later, earlier], '2026-09-01')
    expect(groups.map(group => group.iso)).toEqual(['2026-09-01', '2026-09-02', '2026-08-30'])
    expect(groups[0]).toEqual({ iso: '2026-09-01', tasks: [] })
  })
})
