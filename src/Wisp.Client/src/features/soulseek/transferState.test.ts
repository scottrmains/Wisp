import { describe, expect, it } from 'vitest'
import { transferPercent, transferState } from './transferState'

describe('Soulseek transfer states', () => {
  it.each(['Queued, Locally', 'Queued, Remotely', 'Initializing', 'InProgress', 'Requested', ''])('keeps %s cancellable', state => {
    expect(transferState(state).finished).toBe(false)
    expect(transferState(state).succeeded).toBe(false)
  })
  it.each(['Errored', 'TimedOut', 'Rejected', 'Aborted', 'Failed'])('recognizes %s with and without Completed', state => {
    for (const value of [state, `Completed, ${state}`, ` completed , ${state.toLowerCase()} `]) {
      expect(transferState(value)).toMatchObject({ finished: true, succeeded: false, failed: true, label: 'Failed' })
    }
  })
  it('does not label cancellations or generic completion as successful', () => {
    expect(transferState('Completed, Cancelled')).toMatchObject({ finished: true, succeeded: false, label: 'Cancelled' })
    expect(transferState('Completed')).toMatchObject({ finished: true, succeeded: false, label: 'Finished' })
    expect(transferState('Completed, Succeeded')).toMatchObject({ finished: true, succeeded: true, label: 'Done' })
    expect(transferState('NotCompleted')).toMatchObject({ finished: false, succeeded: false })
  })
  it('clamps malformed percentages', () => {
    expect([NaN, Infinity, -5, 50, 120].map(transferPercent)).toEqual([0, 0, 0, 50, 100])
  })
})
