/** Shown whenever a loaded container is saved without a seal. */
export const LOADED_SEAL_REQUIRED = 'Enter a seal number for a loaded container.'

export function normalizeSealNumber(sealNumber?: string | null): string | null {
  const seal = sealNumber?.trim() || null
  return seal
}

/** Empty boxes never keep a seal. Loaded boxes keep the trimmed value or null. */
export function sealForLoad(isLoaded: boolean, sealNumber?: string | null): string | null {
  return isLoaded ? normalizeSealNumber(sealNumber) : null
}

export function missingLoadedSeal(isLoaded: boolean, sealNumber?: string | null): boolean {
  return isLoaded && !normalizeSealNumber(sealNumber)
}
