import { describe, expect, it } from 'vitest'
import {
  driverTimelineTitle,
  isDriverTimelineEvent,
  timelineNote,
  visibleTimelineEntries,
} from '../shared/utils/timeline'

describe('driver timeline', () => {
  it('hides started, cancelled, and released rows', () => {
    expect(isDriverTimelineEvent('PICKUP_STARTED')).toBe(false)
    expect(isDriverTimelineEvent('PICKUP_CANCELLED')).toBe(false)
    expect(isDriverTimelineEvent('RELEASED')).toBe(false)
    expect(isDriverTimelineEvent('CORRECTION')).toBe(false)
    expect(isDriverTimelineEvent('PICKUP_CONFIRMED')).toBe(true)
    expect(isDriverTimelineEvent('CHASSIS_ATTACH')).toBe(true)
  })

  it('uses equipment language for hang and unhang', () => {
    expect(driverTimelineTitle('PICKUP_CONFIRMED')).toBe('Picked up')
    expect(driverTimelineTitle('DROPOFF_CONFIRMED')).toBe('Dropped off')
    expect(driverTimelineTitle('CHASSIS_ATTACH')).toBe('Container placed on chassis')
    expect(driverTimelineTitle('CHASSIS_DETACH')).toBe('Container removed from chassis')
  })

  it('synthesizes a hang from a pickup that already names the chassis', () => {
    const rows = visibleTimelineEntries([
      { id: 'drop', eventType: 'DROPOFF_CONFIRMED' as const, payload: { retainChassis: false } },
      { id: 'pick', eventType: 'PICKUP_CONFIRMED' as const, chassisNumber: 'SLSZ123456' },
      { id: 'start', eventType: 'PICKUP_STARTED' as const },
      { id: 'cancel', eventType: 'PICKUP_CANCELLED' as const },
    ])
    expect(rows.map(row => row.eventType)).toEqual([
      'DROPOFF_CONFIRMED',
      'CHASSIS_DETACH',
      'PICKUP_CONFIRMED',
      'CHASSIS_ATTACH',
    ])
  })

  it('does not invent a hang when a dedicated chassis event is already stored', () => {
    const rows = visibleTimelineEntries([
      { id: 'pick', eventType: 'PICKUP_CONFIRMED' as const, chassisNumber: 'SLSZ123456' },
      { id: 'hang', eventType: 'CHASSIS_ATTACH' as const, chassisNumber: 'SLSZ123456' },
    ])
    expect(rows.map(row => row.id)).toEqual(['pick', 'hang'])
  })

  it('keeps the box on the chassis when drop-off retained it', () => {
    const rows = visibleTimelineEntries([
      { id: 'drop', eventType: 'DROPOFF_CONFIRMED' as const, payload: { retainChassis: true }, chassisNumber: 'SLSZ123456' },
    ])
    expect(rows.map(row => row.eventType)).toEqual(['DROPOFF_CONFIRMED'])
  })

  it('hides system notes', () => {
    expect(timelineNote('Driver cancelled from Home.')).toBeNull()
    expect(timelineNote('Final release from the tracked network.')).toBeNull()
    expect(timelineNote('Gate was closed.')).toBe('Gate was closed.')
  })
})
