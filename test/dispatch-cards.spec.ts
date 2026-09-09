import { describe, expect, it } from 'vitest'
import {
  applyAssignedStepPatch,
  composeDispatchCardText,
  dispatchCardTitle,
  emptyDispatchCard,
  isDispatchCardComplete,
  normalizeDispatchCard,
} from '../shared/utils/dispatch-cards'
import { emptyStep } from '../shared/utils/task-steps'

describe('composeDispatchCardText', () => {
  it('names the work, box, and route', () => {
    const card = emptyDispatchCard('PICKUP')
    card.containerNumber = 'MSCU4521894'
    card.locationName = 'Sensible Yard — Davie'
    card.destinationLocationName = 'Coastal Tile Imports'
    card.notes = 'Gate 3 after 07:00'
    expect(composeDispatchCardText(card)).toBe([
      'Pickup MSCU452189-4',
      'Sensible Yard — Davie → Coastal Tile Imports',
      'Gate 3 after 07:00',
    ].join('\n'))
  })

  it('marks boxes that are not in the pool yet', () => {
    const card = emptyDispatchCard('DROPOFF')
    card.containerNumber = 'TCLU1234567'
    card.containerPending = true
    card.locationName = 'Port Everglades Terminal 3'
    expect(composeDispatchCardText(card)).toContain('Container not in the yard yet')
  })
})

describe('dispatchCardTitle', () => {
  it('prefers the container number', () => {
    const card = emptyDispatchCard('EMPTY')
    card.containerNumber = 'MSCU4521894'
    expect(dispatchCardTitle(card)).toBe('Empty MSCU452189-4')
  })
})

describe('isDispatchCardComplete', () => {
  it('needs a box, a place, or a note', () => {
    expect(isDispatchCardComplete(emptyDispatchCard())).toBe(false)
    const card = emptyDispatchCard('NOTE')
    card.notes = 'Call the gate'
    expect(isDispatchCardComplete(card)).toBe(true)
  })
})

describe('normalizeDispatchCard', () => {
  it('compacts the container number and keeps a generated id', () => {
    const card = normalizeDispatchCard({
      kind: 'LOAD',
      containerNumber: 'mscu 452189-4',
      locationName: 'Davie',
    })
    expect(card?.containerNumber).toBe('MSCU4521894')
    expect(card?.containerPending).toBe(true)
    expect(card?.id).toBeTruthy()
  })
})

describe('applyAssignedStepPatch', () => {
  it('keeps the assigned wording and only applies done flags', () => {
    const existing = [emptyStep('Pickup at the yard')]
    const incoming = [{ ...existing[0]!, text: 'rewritten', done: true }]
    const next = applyAssignedStepPatch(existing, incoming)
    expect(next[0]!.text).toBe('Pickup at the yard')
    expect(next[0]!.done).toBe(true)
  })
})
