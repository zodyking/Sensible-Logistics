export const CSX_RELEASE_STATUSES = ['OPEN', 'CLAIMED', 'PICKED_UP', 'CANCELLED'] as const
export type CsxReleaseStatus = (typeof CSX_RELEASE_STATUSES)[number]

export function claimCsxRelease(status: CsxReleaseStatus): CsxReleaseStatus | null {
  if (status === 'OPEN') return 'CLAIMED'
  return null
}

export function confirmCsxRelease(status: CsxReleaseStatus): CsxReleaseStatus | null {
  if (status === 'OPEN' || status === 'CLAIMED') return 'PICKED_UP'
  return null
}

export function reopenCsxRelease(status: CsxReleaseStatus): CsxReleaseStatus | null {
  if (status === 'CLAIMED') return 'OPEN'
  return null
}

export function isOpenCsxRelease(status: CsxReleaseStatus): boolean {
  return status === 'OPEN'
}

export function csxInventoryId(releaseId: string): string {
  return `csx:${releaseId}`
}

export function parseCsxInventoryId(id: string): string | null {
  return id.startsWith('csx:') ? id.slice(4) : null
}
