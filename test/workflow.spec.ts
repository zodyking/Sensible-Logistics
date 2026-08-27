import { describe, expect, it } from 'vitest'

import {
  custodyStatusLabel,
  deriveDriverPhase,
  documentChecklistForLocation,
  DRIVER_PHASE_LABELS,
  DRIVER_PHASES,
  greetingForHour,
  laneForLocationType,
  LOCATION_LANES,
  missingDocumentCategories,
  connectedStatusLabel,
} from '../shared/utils/workflow'

describe('driver workflow', () => {
  it('keeps DRIVER_PHASES in lockstep with labels', () => {
    expect([...Object.keys(DRIVER_PHASE_LABELS)].sort()).toEqual([...DRIVER_PHASES].sort())
  })

  it('labels hooked equipment as Connected to the driver name', () => {
    expect(connectedStatusLabel('Marcus Vega')).toBe('Connected to Marcus Vega')
    expect(connectedStatusLabel('  ')).toBe('Connected')
  })

  it('derives idle when nothing is hooked and no live trip exists', () => {
    expect(deriveDriverPhase({ liveTripStatus: null, hookedAtLocation: false })).toBe('idle')
  })

  it('treats overnight hook at a yard as connected, not in transit', () => {
    expect(deriveDriverPhase({ liveTripStatus: null, hookedAtLocation: true })).toBe('connected')
    expect(custodyStatusLabel({
      activePoolState: 'DRIVER_CUSTODY',
      driverName: 'Marcus Vega',
      locationName: 'Sensible Yard — Davie',
    })).toBe('Connected to Marcus Vega')
  })

  it('keeps a rolling movement in transit even if a hook record exists', () => {
    expect(deriveDriverPhase({ liveTripStatus: 'IN_TRANSIT', hookedAtLocation: false })).toBe('in_transit')
    expect(custodyStatusLabel({
      activePoolState: 'DRIVER_CUSTODY',
      driverName: 'Marcus Vega',
      locationName: null,
    })).toBe('In transit with Marcus Vega')
  })

  it('treats an arrived live trip as at_stop so drop-off and swap stay distinct', () => {
    expect(deriveDriverPhase({ liveTripStatus: 'DROPOFF_IN_PROGRESS', hookedAtLocation: true })).toBe('at_stop')
  })

  it('requires rail interchange paper plus photos at a CSX swap', () => {
    const checklist = documentChecklistForLocation('RAIL_TERMINAL')
    expect(missingDocumentCategories(checklist, [])).toEqual(['GATE_TICKET', 'EIR', 'PHOTO'])
    expect(missingDocumentCategories(checklist, ['GATE_TICKET', 'EIR', 'PHOTO'])).toEqual([])
  })

  it('requires POD at a customer swap and treats yard photos as optional', () => {
    expect(missingDocumentCategories(documentChecklistForLocation('CUSTOMER'), [])).toEqual(['POD'])
    expect(missingDocumentCategories(documentChecklistForLocation('COMPANY_YARD'), [])).toEqual([])
  })

  it('groups CSX, marine, yard and customer into the four dashboard lanes', () => {
    expect(LOCATION_LANES.map(lane => lane.id)).toEqual(['rail', 'marine', 'yard', 'customer'])
    expect(laneForLocationType('RAIL_TERMINAL')?.id).toBe('rail')
    expect(laneForLocationType('MARINE_TERMINAL')?.id).toBe('marine')
    expect(laneForLocationType('COMPANY_YARD')?.id).toBe('yard')
    expect(laneForLocationType('CUSTOMER')?.id).toBe('customer')
    expect(laneForLocationType('WAREHOUSE')?.id).toBe('customer')
  })

  it('picks a time-of-day greeting', () => {
    expect(greetingForHour(8)).toBe('Good morning')
    expect(greetingForHour(14)).toBe('Good afternoon')
    expect(greetingForHour(19)).toBe('Good evening')
  })
})
