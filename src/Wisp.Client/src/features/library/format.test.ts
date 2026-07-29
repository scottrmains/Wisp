import { describe, expect, it } from 'vitest'
import { formatBpm, formatDuration } from './format'

describe('library formatting', () => {
  it('formats complete minutes and seconds for CDJ-style track durations', () => {
    expect(formatDuration(305)).toBe('5:05')
  })

  it('does not display invented BPM for tracks without metadata', () => {
    expect(formatBpm(null)).toBe('—')
    expect(formatBpm(124.5)).toBe('124.5')
  })
})
