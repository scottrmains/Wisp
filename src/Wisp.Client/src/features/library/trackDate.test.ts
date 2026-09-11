import { describe, expect, it } from 'vitest'
import { formatTrackDate } from './format'

describe('track dates', () => {
  it('shows an em dash for unknown and invalid values', () => {
    expect(formatTrackDate(null)).toBe('—')
    expect(formatTrackDate('not-a-date')).toBe('—')
  })
  it('treats legacy timestamps as UTC, consistently with explicitly zoned values', () => {
    const expected = formatTrackDate('2026-09-11T10:00:00Z')
    expect(expected).not.toBe('—')
    expect(formatTrackDate('2026-09-11T10:00:00')).toBe(expected)
    expect(formatTrackDate('2026-09-11T11:00:00+01:00')).toBe(expected)
  })
})
