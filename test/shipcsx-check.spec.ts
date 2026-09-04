import { describe, expect, it } from 'vitest'
import { shipcsxCheckProgressLine, shipcsxCheckStep, SHIPCSX_CHECK_STEPS } from '../shared/utils/shipcsx-check'
import { SHIPCSX_REFERENCE } from '../shared/utils/csx-lookup'

describe('ShipCSX check wizard steps', () => {
  it('names six lookup steps in site order', () => {
    expect(SHIPCSX_CHECK_STEPS.map(step => step.id)).toEqual([
      'open',
      'terminal',
      'equipment',
      'reference',
      'search',
      'results',
    ])
    expect(shipcsxCheckStep('terminal')).toEqual({
      stepId: 'terminal',
      stepLabel: 'Selecting terminal',
      stepIndex: 2,
      stepCount: 6,
    })
    expect(shipcsxCheckProgressLine(shipcsxCheckStep('equipment')))
      .toBe('Step 3 of 6 · Typing trailer number')
  })

  it('defaults the extra ShipCSX field to 0000', () => {
    expect(SHIPCSX_REFERENCE).toBe('0000')
  })
})
