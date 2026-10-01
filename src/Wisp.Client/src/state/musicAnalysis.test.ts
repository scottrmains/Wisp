import { expect, it } from 'vitest'
import { useMusicAnalysis } from './musicAnalysis'

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
