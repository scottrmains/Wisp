import { describe, expect, it } from 'vitest'
import { beatTicksInRange, snapToBeat, visibleBeatTicks } from './snap'

describe('beatgrid overview', () => {
  it('shows bounded, spaced, aligned overview lines across a long track', () => {
    const ticks = visibleBeatTicks(0, 600, 128, 0.25, 800)
    expect(ticks.length).toBeGreaterThan(10)
    expect(ticks.length).toBeLessThanOrEqual(80)
    expect(ticks.every((t) => t.beatIndex % 16 === 0)).toBe(true)
    expect(ticks[0].timeSeconds).toBe(0.25)
    expect(ticks.at(-1)!.timeSeconds).toBeLessThanOrEqual(600)
  })
  it('reveals individual beats on zoom and keeps a non-zero anchor', () => {
    const ticks = visibleBeatTicks(18, 22, 120, 0.125, 600)
    expect(ticks[0].timeSeconds).toBe(18.125)
    expect(ticks[1].timeSeconds - ticks[0].timeSeconds).toBe(0.5)
    expect(ticks.some((t) => t.weight === 0.6)).toBe(true)
    expect(beatTicksInRange(0, 600, 120, 0)).toEqual([])
  })
  it('never invents a snapping anchor, or creates ticks for invalid metadata', () => {
    expect(snapToBeat(1.23, 120, null)).toBe(1.23)
    for (const bpm of [null, 0, -1, NaN, Infinity])
      expect(visibleBeatTicks(0, 60, bpm, 0, 800)).toEqual([])
    expect(visibleBeatTicks(0, 60, 120, null, 800)).toEqual([])
    expect(visibleBeatTicks(0, 60, 120, 0, 0)).toEqual([])
    expect(beatTicksInRange(0, 60, 120, NaN)).toEqual([])
  })
})
