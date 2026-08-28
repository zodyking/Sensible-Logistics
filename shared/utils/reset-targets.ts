export const RESET_TARGET_IDS = [
  'locations',
  'containers',
  'trips',
  'chassis',
  'documents',
  'tasks',
  'trucks',
  'users',
] as const

export type ResetTargetId = (typeof RESET_TARGET_IDS)[number]
export type ResetCounts = Record<ResetTargetId, number>

export const RESET_TARGETS: Array<{
  id: ResetTargetId
  label: string
  hint: string
}> = [
  { id: 'locations', label: 'Customers & locations', hint: 'Yards, terminals, and customer sites' },
  { id: 'containers', label: 'Containers', hint: 'Boxes and yard placements' },
  { id: 'trips', label: 'Trips', hint: 'Pickups, drop-offs, and movement history' },
  { id: 'chassis', label: 'Chassis', hint: 'Company chassis records' },
  { id: 'documents', label: 'Documents', hint: 'EIRs, PODs, and uploads' },
  { id: 'tasks', label: 'Tasks', hint: 'SMS and pasted dispatch tasks' },
  { id: 'trucks', label: 'Trucks', hint: 'Company trucks' },
  { id: 'users', label: 'Users', hint: 'Other accounts. Yours stays.' },
]
