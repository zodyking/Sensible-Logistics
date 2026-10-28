import type { TimeCardHeader, TimeCardStop } from './time-card'
import { TIME_CARD_STOP_MAX } from './time-card'

/** Letter page, matching the printed Sensible Logistics short-haul card. */
export const TIME_CARD_PAGE_WIDTH = 612
export const TIME_CARD_PAGE_HEIGHT = 792

export type TimeCardDrawOp = {
  x: number
  /** Distance from the top of the page, same system as the template PDF. */
  topY: number
  size: number
  text: string
}

const HEADER: Record<string, { x: number, topY: number, size?: number, max?: number }> = {
  driverName: { x: 94, topY: 103, max: 36 },
  date: { x: 346, topY: 103, max: 28 },
  truckUnit: { x: 98, topY: 118.2, max: 34 },
  trailerNumber: { x: 356, topY: 118.2, size: 8, max: 46 },
  cdl: { x: 97, topY: 133.5, max: 34 },
  employeeId: { x: 372, topY: 133.5, max: 28 },
  dispatcher: { x: 88, topY: 148.7, max: 36 },
  routeCustomer: { x: 388, topY: 148.7, max: 28 },
  startOdometer: { x: 104, topY: 164, max: 28 },
  endOdometer: { x: 378, topY: 164, max: 28 },
}

const TOTALS: Record<string, { x: number, topY: number, max?: number }> = {
  reportForDuty: { x: 41, topY: 665.8, max: 12 },
  releasedFromDuty: { x: 175, topY: 665.8, max: 12 },
  totalOnDutyHours: { x: 309, topY: 665.8, max: 12 },
  preceding7DayHours: { x: 441, topY: 665.8, max: 16 },
}

const SIGN = {
  signedName: { x: 128, topY: 731.2, max: 28 },
  signedDate: { x: 325, topY: 731.2, max: 10 },
}

/** Shift totals and signature stay empty on the printed card until that section is built. */
export const TIME_CARD_FILL_FOOTER = false

const ROW0_TOP = 220
const ROW_H = 15.85
const COL = {
  timeIn: 64,
  timeOut: 132,
  location: 198,
  activity: 406,
}

/** pdf-lib origin is bottom-left. Sit the baseline just above a form underline. */
export function timeCardPdfY(topY: number): number {
  return TIME_CARD_PAGE_HEIGHT - topY + 2
}

export function clipTimeCardText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  if (maxChars <= 3) return text.slice(0, Math.max(0, maxChars))
  return `${text.slice(0, maxChars - 3)}...`
}

export function timeCardRowTopY(index: number): number {
  return ROW0_TOP + (index + 1) * ROW_H - 4
}

function op(x: number, topY: number, text: string, max: number, size = 9): TimeCardDrawOp | null {
  const clipped = clipTimeCardText(text, max)
  if (!clipped) return null
  return { x, topY, size, text: clipped }
}

/** Overlay positions for every filled field on page 1 of the printed card. */
export function timeCardDrawPlan(header: TimeCardHeader, stops: TimeCardStop[]): TimeCardDrawOp[] {
  const ops: TimeCardDrawOp[] = []

  for (const [field, slot] of Object.entries(HEADER)) {
    const value = header[field as keyof TimeCardHeader] ?? ''
    const drawn = op(slot.x, slot.topY, value, slot.max ?? 32, slot.size ?? 9)
    if (drawn) ops.push(drawn)
  }

  stops.slice(0, TIME_CARD_STOP_MAX).forEach((stop, index) => {
    const topY = timeCardRowTopY(index)
    const timeIn = op(COL.timeIn, topY, stop.timeIn, 5, 8)
    const timeOut = op(COL.timeOut, topY, stop.timeOut, 5, 8)
    const location = op(COL.location, topY, stop.location, 52, 8)
    const activity = op(COL.activity, topY, stop.activity, 38, 8)
    for (const drawn of [timeIn, timeOut, location, activity]) {
      if (drawn) ops.push(drawn)
    }
  })

  if (TIME_CARD_FILL_FOOTER) {
    for (const [field, slot] of Object.entries(TOTALS)) {
      const value = header[field as keyof TimeCardHeader] ?? ''
      const drawn = op(slot.x, slot.topY, value, slot.max ?? 12, 9)
      if (drawn) ops.push(drawn)
    }
    const signedName = op(SIGN.signedName.x, SIGN.signedName.topY, header.signedName, SIGN.signedName.max, 9)
    const signedDate = op(SIGN.signedDate.x, SIGN.signedDate.topY, header.signedDate, SIGN.signedDate.max, 9)
    if (signedName) ops.push(signedName)
    if (signedDate) ops.push(signedDate)
  }

  return ops
}
