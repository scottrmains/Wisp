import { describe, expect, it } from 'vitest'
import { formatBpm, formatCueTime, formatDuration, trackDisplayTitle } from './format'

describe('library formatting', () => {
  it('includes the mix/version without changing or duplicating embedded tags', () => {
    const track = { title: 'Show Me Love', version: 'Tonka’s 2002 Club Mix', fileName: 'audio.mp3' }
    expect(trackDisplayTitle(track)).toBe('Show Me Love (Tonka’s 2002 Club Mix)')
    expect(trackDisplayTitle({ ...track, title: "Show Me Love (TONKA'S 2002 CLUB MIX)" })).toBe(
      "Show Me Love (TONKA'S 2002 CLUB MIX)",
    )
    expect(trackDisplayTitle({ ...track, version: '(Extended Mix)' })).toBe(
      'Show Me Love (Extended Mix)',
    )
    expect(trackDisplayTitle({ ...track, title: null })).toBe('audio.mp3')
    expect(trackDisplayTitle({ ...track, version: ' ' })).toBe('Show Me Love')
    expect(track.title).toBe('Show Me Love')
  })
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
