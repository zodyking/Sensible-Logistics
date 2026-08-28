import { describe, expect, it } from 'vitest'
import {
  allStepsDone,
  emptyStep,
  mergeWithPrevious,
  normalizeSteps,
  splitStepAt,
  splitStepLines,
  stepsFromBlob,
} from '../shared/utils/task-steps'

describe('stepsFromBlob', () => {
  it('keeps the full paste as one step', () => {
    const steps = stepsFromBlob('1. Pickup TCLU at NJ Yard\n- Drop off Coastal Tile\n\nEmpty to depot')
    expect(steps).toHaveLength(1)
    expect(steps[0]!.text).toBe('1. Pickup TCLU at NJ Yard\n- Drop off Coastal Tile\n\nEmpty to depot')
    expect(steps[0]!.done).toBe(false)
  })

  it('returns an empty list for blank input', () => {
    expect(stepsFromBlob('  \n  ')).toEqual([])
  })
})

describe('splitStepAt', () => {
  it('breaks one step into two at the caret', () => {
    const start = stepsFromBlob('Pickup at the yard then drop off')
    const split = splitStepAt(start, 0, 'Pickup at the yard'.length)
    expect(split).toHaveLength(2)
    expect(split[0]!.text).toBe('Pickup at the yard')
    expect(split[1]!.text).toBe('then drop off')
  })
})

describe('splitStepLines', () => {
  it('turns a pasted block into one step per line', () => {
    const start = stepsFromBlob('Pickup TCLU at NJ Yard\nDrop off Coastal Tile\nEmpty to depot')
    const split = splitStepLines(start, 0)
    expect(split.map(step => step.text)).toEqual([
      'Pickup TCLU at NJ Yard',
      'Drop off Coastal Tile',
      'Empty to depot',
    ])
    expect(split[0]!.id).toBe(start[0]!.id)
  })

  it('leaves a single line unchanged', () => {
    const start = stepsFromBlob('Pickup at the yard')
    expect(splitStepLines(start, 0)).toEqual(start)
  })
})

describe('mergeWithPrevious', () => {
  it('joins a step back onto the line above', () => {
    const start = [emptyStep('Pickup at the yard'), emptyStep('then drop off')]
    const merged = mergeWithPrevious(start, 1)
    expect(merged?.steps).toHaveLength(1)
    expect(merged?.steps[0]!.text).toBe('Pickup at the yard then drop off')
    expect(merged?.caret).toBe('Pickup at the yard'.length + 1)
  })

  it('returns null on the first step', () => {
    expect(mergeWithPrevious(stepsFromBlob('Only one'), 0)).toBeNull()
  })
})

describe('normalizeSteps', () => {
  it('keeps blank rows that already have an id', () => {
    const steps = normalizeSteps([
      { id: 'a', text: 'Pickup', done: false },
      { id: 'b', text: '  ', done: false },
    ])
    expect(steps).toHaveLength(2)
    expect(steps[1]).toMatchObject({ id: 'b', text: '', done: false })
  })

  it('drops blank rows with no id', () => {
    expect(normalizeSteps([{ text: '  ', done: false }])).toEqual([])
  })
})

describe('allStepsDone', () => {
  it('is true only when every step is checked', () => {
    const steps = [emptyStep('A'), emptyStep('B')]
    expect(allStepsDone(steps)).toBe(false)
    steps[0]!.done = true
    steps[1]!.done = true
    expect(allStepsDone(steps)).toBe(true)
  })
})
