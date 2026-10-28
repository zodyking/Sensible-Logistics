import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  applyHeaderOverrides,
  blankTimeCardHeader,
  cdlLabel,
  formatTimeCardClock,
  formatTimeCardDate,
  formatTimeCardLocation,
  mergeIncomingPing,
  mergeTimeCardStops,
  onDutyHoursLabel,
  shiftTotals,
  stopsFromPings,
  stopsFromTrips,
  trailerFromTrips,
  zonedDayRange,
} from '../shared/utils/time-card'
import { clipTimeCardText, timeCardDrawPlan, timeCardPdfY, timeCardRowTopY } from '../shared/utils/time-card-layout'
import { coerceTimeCardPdfBytes, fillTimeCardPdf } from '../server/services/time-card-pdf'

const ZONE = 'America/New_York'

describe('formatTimeCardDate', () => {
  it('prints the card date as month/day/year', () => {
    expect(formatTimeCardDate('2026-10-28')).toBe('10/28/2026')
  })
})

describe('formatTimeCardClock', () => {
  it('prints 24-hour clock in the company zone', () => {
    expect(formatTimeCardClock('2026-10-28T12:15:00.000Z', ZONE)).toBe('08:15')
  })
})

describe('onDutyHoursLabel', () => {
  it('counts from first in to last out', () => {
    expect(onDutyHoursLabel('06:00', '17:30')).toBe('11:30')
  })
})

describe('stopsFromTrips', () => {
  it('writes pickup and drop-off rows from a live movement', () => {
    const stops = stopsFromTrips([
      {
        id: 'trip-1',
        kind: 'CONTAINER',
        isLoaded: true,
        containerNumber: 'BSIU9761081',
        chassisNumber: 'AIMZ481203',
        originName: 'Queens Yard',
        originCity: 'Jamaica',
        originState: 'NY',
        destinationName: 'Whisky',
        destinationCity: 'Brooklyn',
        destinationState: 'NY',
        originLocationId: 'loc-q',
        destinationLocationId: 'loc-w',
        createdAt: '2026-10-28T11:00:00.000Z',
        pickedUpAt: '2026-10-28T11:20:00.000Z',
        droppedOffAt: '2026-10-28T15:05:00.000Z',
      },
    ], ZONE)
    expect(stops).toEqual([
      {
        key: 'TRIP:trip-1:PICKUP',
        timeIn: '07:00',
        timeOut: '07:20',
        location: 'Queens Yard, Jamaica, NY',
        activity: 'Pickup BSIU9761081 · Loaded',
        source: 'TRIP',
        tripId: 'trip-1',
        locationId: 'loc-q',
      },
      {
        key: 'TRIP:trip-1:DROPOFF',
        timeIn: '11:05',
        timeOut: '11:05',
        location: 'Whisky, Brooklyn, NY',
        activity: 'Drop-off BSIU9761081 · Loaded',
        source: 'TRIP',
        tripId: 'trip-1',
        locationId: 'loc-w',
      },
    ])
    expect(shiftTotals(stops)).toEqual({
      reportForDuty: '07:00',
      releasedFromDuty: '11:05',
      totalOnDutyHours: '4:05',
    })
  })
})

describe('stopsFromPings', () => {
  it('collapses consecutive pings at one yard into a dwell', () => {
    const stops = stopsFromPings([
      { at: '2026-10-28T12:00:00.000Z', latitude: 1, longitude: 2, locationId: 'a', locationName: 'Maher Terminals' },
      { at: '2026-10-28T12:08:00.000Z', latitude: 1, longitude: 2, locationId: 'a', locationName: 'Maher Terminals' },
      { at: '2026-10-28T13:00:00.000Z', latitude: 1, longitude: 2, locationId: 'b', locationName: 'PNCT' },
    ], ZONE)
    expect(stops).toHaveLength(2)
    expect(stops[0]).toMatchObject({
      location: 'Maher Terminals',
      timeIn: '08:00',
      timeOut: '08:08',
      activity: 'On site',
      source: 'GPS',
    })
    expect(stops[1]?.location).toBe('PNCT')
  })
})

describe('mergeTimeCardStops', () => {
  it('keeps a driver correction and drops GPS that a trip already covers', () => {
    const auto = stopsFromTrips([
      {
        id: 'trip-1',
        kind: 'CONTAINER',
        isLoaded: false,
        containerNumber: 'MSCU4521894',
        originName: 'Queens Yard',
        originLocationId: 'loc-q',
        createdAt: '2026-10-28T11:00:00.000Z',
        pickedUpAt: '2026-10-28T11:10:00.000Z',
      },
    ], ZONE)
    const gps = stopsFromPings([
      { at: '2026-10-28T11:02:00.000Z', latitude: 1, longitude: 2, locationId: 'loc-q', locationName: 'Queens Yard' },
    ], ZONE)
    const saved = [
      { ...auto[0]!, timeOut: '07:45', corrected: true, source: 'TRIP' as const },
    ]
    const merged = mergeTimeCardStops([...auto, ...gps], saved)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.timeOut).toBe('07:45')
  })
})

describe('formatTimeCardLocation', () => {
  it('appends city and state after the site name', () => {
    expect(formatTimeCardLocation('Queens Yard', 'Jamaica', 'NY')).toBe('Queens Yard, Jamaica, NY')
    expect(formatTimeCardLocation('Whisky', null, 'NY')).toBe('Whisky, NY')
    expect(formatTimeCardLocation('Maher Terminals')).toBe('Maher Terminals')
  })
})

describe('trailerFromTrips', () => {
  it('lists every chassis in trip order and skips repeats', () => {
    expect(trailerFromTrips([
      { id: 'a', chassisNumber: 'AIMZ481203', createdAt: '2026-10-28T11:00:00.000Z' },
      { id: 'b', chassisNumber: 'DCLI220144', createdAt: '2026-10-28T13:00:00.000Z' },
      { id: 'c', chassisNumber: 'AIMZ481203', createdAt: '2026-10-28T15:00:00.000Z' },
    ])).toBe('AIMZ481203, DCLI220144')
  })
})

describe('cdlLabel', () => {
  it('stays blank without a CDL number', () => {
    expect(cdlLabel(null, 'NY')).toBe('')
    expect(cdlLabel('  ', 'NY')).toBe('')
    expect(cdlLabel('1234567', 'NY')).toBe('1234567 / NY')
  })
})

describe('clipTimeCardText', () => {
  it('uses three dots when the trailer line is too long', () => {
    expect(clipTimeCardText('AIMZ481203, DCLI220144, FLXI907712', 24)).toBe('AIMZ481203, DCLI22014...')
  })
})

describe('applyHeaderOverrides', () => {
  it('only replaces fields the driver edited', () => {
    expect(applyHeaderOverrides(
      { driverName: 'Auto Name', truckUnit: '12' },
      { driverName: 'Pat Driver', truckUnit: '99' },
      ['driverName'],
    )).toEqual({ driverName: 'Pat Driver', truckUnit: '12' })
  })
})

describe('mergeIncomingPing', () => {
  it('extends a dwell instead of dropping a still ping', () => {
    const first = { at: '2026-10-28T12:00:00.000Z', latitude: 40.7, longitude: -73.8, locationId: 'a', locationName: 'Queens Yard' }
    const still = { at: '2026-10-28T12:10:00.000Z', latitude: 40.7001, longitude: -73.8001, locationId: 'a', locationName: 'Queens Yard' }
    const merged = mergeIncomingPing([first], still)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.at).toBe(still.at)
  })
})

describe('mergeTimeCardStops GPS after a trip', () => {
  it('keeps an afternoon GPS dwell at a yard used for a morning pickup', () => {
    const auto = stopsFromTrips([
      {
        id: 'trip-1',
        kind: 'CONTAINER',
        isLoaded: false,
        containerNumber: 'MSCU4521894',
        originName: 'Queens Yard',
        originLocationId: 'loc-q',
        createdAt: '2026-10-28T11:00:00.000Z',
        pickedUpAt: '2026-10-28T11:10:00.000Z',
      },
    ], ZONE)
    const gps = stopsFromPings([
      { at: '2026-10-28T21:00:00.000Z', latitude: 1, longitude: 2, locationId: 'loc-q', locationName: 'Queens Yard' },
      { at: '2026-10-28T21:20:00.000Z', latitude: 1, longitude: 2, locationId: 'loc-q', locationName: 'Queens Yard' },
    ], ZONE)
    const merged = mergeTimeCardStops([...auto, ...gps], [])
    expect(merged).toHaveLength(2)
    expect(merged[1]?.source).toBe('GPS')
    expect(merged[1]?.timeIn).toBe('17:00')
  })
})

describe('zonedDayRange', () => {
  it('starts Eastern Daylight Time midnight in UTC', () => {
    expect(zonedDayRange('2026-10-28', ZONE).start.toISOString()).toBe('2026-10-28T04:00:00.000Z')
    expect(zonedDayRange('2026-10-28', ZONE).end.toISOString()).toBe('2026-10-29T04:00:00.000Z')
  })
})

describe('timeCardDrawPlan', () => {
  it('places header and stop text on the printed card', () => {
    const header = blankTimeCardHeader('2026-10-28')
    header.driverName = 'Pat Driver'
    header.reportForDuty = '07:00'
    header.releasedFromDuty = '17:05'
    header.totalOnDutyHours = '10:05'
    header.signedName = 'Pat Driver'
    header.signedDate = '10/28/2026'
    const plan = timeCardDrawPlan(header, [
      {
        key: 'TRIP:1:PICKUP',
        timeIn: '07:00',
        timeOut: '07:20',
        location: 'Queens Yard',
        activity: 'Pickup BSIU9761081 · Loaded',
        source: 'TRIP',
      },
    ])
    expect(plan.some(op => op.text === 'Pat Driver' && op.topY === 103)).toBe(true)
    expect(plan.some(op => op.text === 'Queens Yard' && op.topY === timeCardRowTopY(0))).toBe(true)
    expect(plan.some(op => op.text === '07:00' && op.topY > 640)).toBe(false)
    expect(plan.some(op => op.text === 'Pat Driver' && op.topY > 700)).toBe(false)
    expect(timeCardPdfY(103)).toBe(792 - 103 + 2)
  })
})

describe('coerceTimeCardPdfBytes', () => {
  it('accepts buffers, typed arrays, and latin1 PDF strings', () => {
    const raw = Buffer.from('%PDF-1.4 demo')
    const magic = [0x25, 0x50, 0x44, 0x46]
    expect(Array.from(coerceTimeCardPdfBytes(raw)?.subarray(0, 4) ?? [])).toEqual(magic)
    expect(coerceTimeCardPdfBytes(new Uint8Array(raw))?.byteLength).toBe(raw.byteLength)
    expect(Array.from(coerceTimeCardPdfBytes(raw.toString('latin1'))?.subarray(0, 4) ?? [])).toEqual(magic)
    expect(coerceTimeCardPdfBytes({ type: 'Buffer', data: [...raw] })?.byteLength).toBe(raw.byteLength)
    expect(coerceTimeCardPdfBytes('not a pdf')).toBeNull()
  })
})

describe('blank Word template', () => {
  it('ships a Word file of the exact two-page printed card', () => {
    const bytes = readFileSync('server/assets/forms/short-haul-time-card.docx')
    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4B)
    expect(bytes.byteLength).toBeGreaterThan(50_000)
  })
})

describe('fillTimeCardPdf', () => {
  it('writes onto the exact two-page template', async () => {
    const header = blankTimeCardHeader('2026-10-28')
    header.driverName = 'Pat Driver'
    header.truckUnit = '12'
    header.reportForDuty = '07:00'
    header.releasedFromDuty = '17:05'
    header.totalOnDutyHours = '10:05'
    header.preceding7DayHours = '42:00'
    header.signedName = 'Pat Driver'
    header.signedDate = '10/28/2026'
    const bytes = await fillTimeCardPdf(header, [
      {
        key: 'TRIP:1:PICKUP',
        timeIn: '07:00',
        timeOut: '07:20',
        location: 'Queens Yard',
        activity: 'Pickup box',
        source: 'TRIP',
      },
    ])
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(2)
    expect(bytes.byteLength).toBeGreaterThan(100_000)
    const size = pdf.getPage(0).getSize()
    expect(Math.round(size.width)).toBe(612)
    expect(Math.round(size.height)).toBe(792)
  })
})
