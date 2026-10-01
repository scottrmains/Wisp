import { describe, expect, it } from 'vitest'
import { normalizeNavigation } from './workspaceNavigation'

describe('workspace navigation preferences', () => {
  it('adds independent defaults without requiring old profiles to rescan', () => {
    expect(normalizeNavigation(null)).toEqual({
      plans: { width: 240, collapsed: false },
      artists: { width: 240, collapsed: false },
      sources: { width: 240, collapsed: false },
    })
  })
  it('bounds persisted widths and rejects invalid values', () => {
    expect(
      normalizeNavigation({
        plans: { width: -40, collapsed: true },
        artists: { width: 10000, collapsed: false },
        sources: { width: NaN, collapsed: 'false' },
      }),
    ).toEqual({
      plans: { width: 180, collapsed: true },
      artists: { width: 360, collapsed: false },
      sources: { width: 240, collapsed: false },
    })
  })
  it('rounds valid widths, preserves collapse and ignores unrelated keys', () => {
    expect(
      normalizeNavigation({ plans: { width: 263.5, collapsed: true }, obsolete: {} }).plans,
    ).toEqual({ width: 264, collapsed: true })
  })
})
