/**
 * Tasks page grouping. Manual pastes file on the calendar day they were added;
 * SMS can still land on a parsed work date.
 *
 * Order: today, then upcoming (soonest first), then earlier (newest first).
 */

export function groupTasksByWorkDate<T extends { workDate: string, status: string }>(
  tasks: readonly T[],
  todayIso: string,
): Array<{ iso: string, tasks: T[] }> {
  const map = new Map<string, T[]>()
  if (todayIso) map.set(todayIso, [])

  for (const task of tasks) {
    if (task.status === 'DISMISSED') continue
    const list = map.get(task.workDate) ?? []
    list.push(task)
    map.set(task.workDate, list)
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
