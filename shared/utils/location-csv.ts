import { LOCATION_TYPE_LABELS, type LocationType } from './domain'
import { formatPhoneDisplay } from './phone'

export type LocationDirectoryRow = {
  name: string
  type: string
  locationCode?: string | null
  addressLine1?: string | null
  addressLine2?: string | null
  city?: string | null
  state?: string | null
  postalCode?: string | null
  country?: string | null
  mainPhone?: string | null
  contactName?: string | null
  contactPhone?: string | null
  hours?: string | null
  appointmentRequired?: boolean | null
  status?: string | null
  gateInstructions?: string | null
  driverNotes?: string | null
  shipcsxTerminal?: string | null
  capacity?: number | null
}

export const LOCATION_CSV_HEADERS = [
  'Name',
  'Type',
  'Code',
  'Address',
  'Address 2',
  'City',
  'State',
  'Postal code',
  'Country',
  'Main phone',
  'Contact name',
  'Contact phone',
  'Hours',
  'Appointment',
  'Status',
  'Gate instructions',
  'Driver notes',
  'ShipCSX terminal',
  'Capacity',
] as const

export function locationCsvFileName(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `locations-${year}-${month}-${day}.csv`
}

export function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function typeLabel(type: string): string {
  if (type in LOCATION_TYPE_LABELS) return LOCATION_TYPE_LABELS[type as LocationType]
  return type.replace(/_/g, ' ')
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return ''
  return status
    .toLowerCase()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function locationCsvRow(row: LocationDirectoryRow): string[] {
  return [
    row.name.trim(),
    typeLabel(row.type),
    row.locationCode?.trim() || '',
    row.addressLine1?.trim() || '',
    row.addressLine2?.trim() || '',
    row.city?.trim() || '',
    row.state?.trim() || '',
    row.postalCode?.trim() || '',
    row.country?.trim() || 'US',
    formatPhoneDisplay(row.mainPhone),
    row.contactName?.trim() || '',
    formatPhoneDisplay(row.contactPhone),
    row.hours?.trim() || '',
    row.appointmentRequired ? 'Yes' : 'No',
    statusLabel(row.status),
    row.gateInstructions?.trim() || '',
    row.driverNotes?.trim() || '',
    row.shipcsxTerminal?.trim() || '',
    row.capacity == null ? '' : String(row.capacity),
  ]
}

/** UTF-8 CSV with a BOM so Excel keeps the columns intact. */
export function formatLocationDirectoryCsv(rows: readonly LocationDirectoryRow[]): string {
  const lines = [
    LOCATION_CSV_HEADERS.map(csvCell).join(','),
    ...rows.map(row => locationCsvRow(row).map(csvCell).join(',')),
  ]
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
