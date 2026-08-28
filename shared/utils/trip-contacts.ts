export interface LocationPhones {
  name?: string | null
  mainPhone?: string | null
  contactPhone?: string | null
  contactName?: string | null
}

export interface LocationPhoneLine {
  key: 'main' | 'secondary'
  label: string
  phone: string
  person?: string | null
}

/** Main switchboard and secondary contact line for a pickup or drop-off site. */
export function locationPhoneLines(location: LocationPhones | null | undefined): LocationPhoneLine[] {
  const lines: LocationPhoneLine[] = []
  const main = location?.mainPhone?.trim() || ''
  const secondary = location?.contactPhone?.trim() || ''
  const person = location?.contactName?.trim() || null

  if (main) lines.push({ key: 'main', label: 'Main', phone: main })
  if (secondary) {
    lines.push({
      key: 'secondary',
      label: 'Secondary',
      phone: secondary,
      person,
    })
  }
  return lines
}
