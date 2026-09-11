import { describe, expect, it } from 'vitest'
import { safeGain, type LoudnessState } from './loudness'

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
