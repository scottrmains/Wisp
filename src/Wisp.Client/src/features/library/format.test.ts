import { describe, expect, it } from 'vitest'
import { formatBpm, formatCueTime, formatDuration } from './format'

describe('library formatting', () => {
  it('formats complete minutes and seconds for CDJ-style track durations', () => {
    expect(formatDuration(305)).toBe('5:05')
  })

  it('does not display invented BPM for tracks without metadata', () => {
    expect(formatBpm(null)).toBe('—')
    expect(formatBpm(124.5)).toBe('124.5')
  })
  it('keeps precise cue timestamps and rolls rounding into the next minute', () => {
    expect(formatCueTime(0)).toBe('0:00.000')
    expect(formatCueTime(59.9999)).toBe('1:00.000')
    expect(formatCueTime(61.01)).toBe('1:01.010')
    expect(formatCueTime(Number.NaN)).toBe('—')
  })
})
