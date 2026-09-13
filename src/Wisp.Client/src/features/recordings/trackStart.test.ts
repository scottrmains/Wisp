import { describe, expect, it } from 'vitest'
import { formatTrackStart, parseTrackStart } from './useRecordingTracklist'

describe('recording-relative track starts', () => {
  it('accepts seconds and timestamp notation without confusing source cue times', () => {
    expect(parseTrackStart('90.25')).toBe(90.25)
    expect(parseTrackStart('1:30.25')).toBe(90.25)
    expect(parseTrackStart(' 2:01:30.25 ')).toBe(7290.25)
    expect(parseTrackStart('0')).toBe(0)
  })
  it('rejects invalid or ambiguous input', () => {
    for (const value of ['', '-1', 'NaN', 'Infinity', '1:70', '1:60:00', '1:2:3:4', '1e3', 'hello']) expect(parseTrackStart(value)).toBeNull()
  })
  it('rounds to hundredths with proper carry', () => {
    expect(formatTrackStart(59.999)).toBe('0:01:00.00')
    expect(formatTrackStart(7290.25)).toBe('2:01:30.25')
  })
})
