import { describe, expect, it } from 'vitest'
import {
  addIsoDays,
  calendarDateInZone,
  classifyDispatchKind,
  isDispatchMessage,
  isSetupTestMessage,
  parseDispatchSms,
  resolveWorkDate,
  SETUP_TEST_PHRASE,
} from '../shared/utils/sms-task'

describe('calendarDateInZone', () => {
  it('returns the New York calendar day around a UTC evening stamp', () => {
    const stamp = new Date('2026-08-28T03:30:00.000Z')
    expect(calendarDateInZone(stamp, 'America/New_York')).toBe('2026-08-27')
    expect(calendarDateInZone(stamp, 'UTC')).toBe('2026-08-28')
  })
})

describe('isSetupTestMessage', () => {
  it('matches the on-screen setup phrase and a short webhook test', () => {
    expect(isSetupTestMessage(SETUP_TEST_PHRASE)).toBe(true)
    expect(isSetupTestMessage('  sensible setup test  ')).toBe(true)
    expect(isSetupTestMessage('test webhook')).toBe(true)
    expect(isSetupTestMessage('Work for tomorrow pickup at the yard')).toBe(false)
  })
})

describe('isDispatchMessage', () => {
  it('keeps work, pickup, and drop-off phrasing and drops chatter', () => {
    expect(isDispatchMessage('Work for tommorow')).toBe(true)
    expect(isDispatchMessage('Pickup TCLU1234567 at NJ Yard')).toBe(true)
    expect(isDispatchMessage('Drop off at Coastal Tile after lunch')).toBe(true)
    expect(isDispatchMessage('You left your lunch in the office')).toBe(false)
    expect(isDispatchMessage(SETUP_TEST_PHRASE)).toBe(false)
  })
})

describe('resolveWorkDate', () => {
  const today = '2026-08-28'

  it('files work-for-tomorrow on the day the message was added', () => {
    expect(resolveWorkDate('Work for tomorrow', today)).toBe(today)
    expect(resolveWorkDate('Work for tommorow', today)).toBe(today)
    expect(resolveWorkDate('work for tomorow pickup at the yard', today)).toBe(today)
  })

  it('keeps work for today on the current calendar day', () => {
    expect(resolveWorkDate('Work for today — two pickups', today)).toBe(today)
  })

  it('does not jump to a named weekday', () => {
    expect(resolveWorkDate('Work for Friday live load', today)).toBe(today)
    expect(resolveWorkDate('Work for Monday pickup', today)).toBe(today)
  })

  it('defaults messages without a day phrase to today', () => {
    expect(resolveWorkDate('Pickup at Port Everglades', today)).toBe(today)
  })

  it('shifts ISO dates without timezone drift', () => {
    expect(addIsoDays('2026-08-31', 1)).toBe('2026-09-01')
  })
})

describe('classifyDispatchKind', () => {
  it('picks a single kind, or WORK when the text mixes jobs', () => {
    expect(classifyDispatchKind('Pickup TCLU at the yard')).toBe('PICKUP')
    expect(classifyDispatchKind('Drop off at the customer')).toBe('DROPOFF')
    expect(classifyDispatchKind('Empty back to the depot')).toBe('EMPTY')
    expect(classifyDispatchKind('Live load at Coastal Tile')).toBe('LOAD')
    expect(classifyDispatchKind('Work for tomorrow pickup and drop off')).toBe('WORK')
    expect(classifyDispatchKind('Work for tomorrow')).toBe('WORK')
  })
})

describe('parseDispatchSms', () => {
  it('files a work-for-tomorrow blob on the day it was added', () => {
    const parsed = parseDispatchSms('Work for tommorow pickup TCLU 1234567 at NJ Yard', '2026-08-28')
    expect(parsed).toMatchObject({
      kind: 'WORK',
      workDate: '2026-08-28',
      title: 'Work for Fri, Aug 28',
    })
    expect(parsed?.containerNumbers).toContain('TCLU1234567')
  })

  it('returns null for the setup test and for unrelated texts', () => {
    expect(parseDispatchSms(SETUP_TEST_PHRASE, '2026-08-28')).toBeNull()
    expect(parseDispatchSms('Running late, grab coffee', '2026-08-28')).toBeNull()
  })
})
