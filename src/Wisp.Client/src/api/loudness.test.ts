import { describe, expect, it } from 'vitest'
import { safeGain, loudnessPlan, type LoudnessState } from './loudness'

describe('safe loudness gain', () => {
  it.each([
    [-22, -15, -14, 8],
    [-22, -2, -14, 0.8],
    [-9, -0.1, -14, -5],
    [-14, -0.1, -14, -1.1],
  ])('source %s LUFS, peak %s, target %s gives %s dB', (input, peak, target, expected) => {
    const row: LoudnessState = { track: {} as LoudnessState['track'], originalPath: '', originalExists: true,
      normalizedExists: false, analysisStale: false, normalization: null,
      analysis: { id: '', sourcePath: '', scannedAt: '', targetLufs: target,
        measurement: { integratedLufs: input, truePeakDb: peak, loudnessRange: 5, durationSeconds: 30 } } }
    expect(safeGain(row)).toBeCloseTo(expected)
  })
})

describe('boost-only review matches server planning', () => {
  it.each([
    [-13.59, 0.28, -14, true, false, 'unchanged', 0],
    [-13.59, 0.28, -8, true, false, 'needs-limiting', 0],
    [-13.59, 0.28, -8, true, true, 'limit', 5.59],
    [-7, 1, -8, true, true, 'unchanged', 0],
    [-22, -15, -14, true, false, 'boost', 8],
    [-22, -2, -14, true, false, 'partial-boost', 0.8],
    [-14.5, -3, -14, true, false, 'unchanged', 0],
    [-7, 1, -14, false, false, 'reduce', -7],
    [-13.59, 0.28, -14, false, false, 'reduce', -1.48],
  ] as const)('input %s peak %s target %s boost-only %s limiting %s → %s', (input, peak, target, boostOnly, limiting, action, gain) => {
    const row = { analysis: { targetLufs: target, measurement: { integratedLufs: input, truePeakDb: peak } } } as LoudnessState
    const plan = loudnessPlan(row, boostOnly, limiting)!
    expect(plan.action).toBe(action); expect(plan.gainDb).toBeCloseTo(gain)
    expect(plan.canCreate).toBe(!['unchanged', 'needs-limiting'].includes(action))
    if (boostOnly) expect(plan.gainDb).toBeGreaterThanOrEqual(0)
  })
})
