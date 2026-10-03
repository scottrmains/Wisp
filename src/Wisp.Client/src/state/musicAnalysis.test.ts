import { expect, it } from 'vitest'
import { useMusicAnalysis } from './musicAnalysis'

it('keeps missing-BPM preset on reopen and resets it for a new selected analysis', () => {
  const store = useMusicAnalysis
  const before = store.getState().requestVersion
  store.getState().show(['a', 'a', 'b'], 'missing-bpm')
  expect(store.getState()).toMatchObject({
    ids: ['a', 'b'],
    preset: 'missing-bpm',
    requestVersion: before + 1,
  })
  store.getState().hide()
  store.getState().show()
  expect(store.getState().preset).toBe('missing-bpm')
  expect(store.getState().requestVersion).toBe(before + 1)
  store.getState().show(['c'])
  expect(store.getState()).toMatchObject({ preset: null, requestVersion: before + 2 })
})

it('deduplicates selected tracks and keeps job identity across hide/reopen without re-adopting dismissed jobs', () => {
  const store = useMusicAnalysis
  store.getState().show(['1', '1', '2'])
  expect(store.getState().ids).toEqual(['1', '2'])
  store.getState().setJob('job')
  store.getState().hide()
  store.getState().show()
  expect(store.getState()).toMatchObject({ open: true, jobId: 'job', ids: ['1', '2'] })
  store.getState().dismiss()
  expect(store.getState()).toMatchObject({ jobId: null, dismissedJobId: 'job' })
  store.getState().setJob('next')
  expect(store.getState().dismissedJobId).toBeNull()
})
