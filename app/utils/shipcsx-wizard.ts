import { wizardShipcsxTerminal, type ShipcsxTerminalName } from '#shared/utils/csx-lookup'

function storageKey(containerId: string) {
  return `shipcsx-wizard-terminal:${containerId}`
}

/** Last CSX facility the driver picked on Check CSX for this box. */
export function readWizardTerminal(containerId: string): ShipcsxTerminalName | null {
  if (!import.meta.client || !containerId) return null
  try {
    return wizardShipcsxTerminal(localStorage.getItem(storageKey(containerId)))
  }
  catch {
    return null
  }
}

export function rememberWizardTerminal(containerId: string, terminal: string) {
  const match = wizardShipcsxTerminal(terminal)
  if (!import.meta.client || !containerId || !match) return
  try {
    localStorage.setItem(storageKey(containerId), match)
  }
  catch {
    // Private mode can block storage; the POST body still carries the pick.
  }
}
