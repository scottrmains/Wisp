import { describe, expect, it } from 'vitest'
import { analysisDraft, analysisRunning, type AnalysisRow } from './musicAnalysis'

const row: AnalysisRow = {
  trackId: '1',
  title: 'Garage Dub',
  status: 'review',
  message: null,
  existingBpm: null,
  existingKey: null,
  cached: false,
  bpmRequested: true,
  keyRequested: true,
  result: {
    bpm: 128.37,
    key: '8A',
    tempoStrength: 0.9,
    keyStrength: 0.8,
    tempoUncertain: false,
    keyUncertain: false,
    seconds: 30,
    engine: 'test',
  },
}
describe('analysis review defaults', () => {
  it('offers missing requested values only', () => {
    expect(analysisDraft(row)).toEqual({ bpm: '128.37', useBpm: true, useKey: true })
    expect(analysisDraft({ ...row, existingBpm: 120, existingKey: 'F# minor' })).toMatchObject({
      useBpm: false,
      useKey: false,
    })
    expect(analysisDraft({ ...row, bpmRequested: false })).toMatchObject({
      useBpm: false,
      useKey: true,
    })
  })
  it('does not preselect uncertain or absent suggestions', () => {
    expect(
      analysisDraft({
        ...row,
        result: { ...row.result!, tempoUncertain: true, keyUncertain: true },
      }),
    ).toMatchObject({ useBpm: false, useKey: false })
    expect(analysisDraft({ ...row, result: null })).toEqual({
      bpm: '',
      useBpm: false,
      useKey: false,
    })
  })
  it('treats cancelling as still running, but not terminal states', () => {
    for (const value of ['queued', 'running', 'cancelling'])
      expect(analysisRunning(value)).toBe(true)
    for (const value of ['completed', 'cancelled', undefined])
      expect(analysisRunning(value)).toBe(false)
  })
  it('does not preselect suggestions from recovered decoding, including cached results', () => {
    expect(
      analysisDraft({
        ...row,
        cached: true,
        result: { ...row.result!, decodeWarning: 'Recovered file warning' },
      }),
    ).toMatchObject({ useBpm: false, useKey: false })
  })
})
