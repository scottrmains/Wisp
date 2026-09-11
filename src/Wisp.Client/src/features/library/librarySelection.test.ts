import { describe, expect, it, vi } from 'vitest'
import type { Track, TrackPage } from '../../api/types'
import { collectSelection, prepHeight, selectionScope, trackRowId, uniqueTrackIds } from './librarySelection'

function rows(start: number, count: number): Track[] {
  return Array.from({ length: count }, (_, i) => ({ id: String(start + i) } as Track))
}

describe('whole-result library selection', () => {
  it('keeps repeated playlist entries independently selectable but deduplicates file/library actions', async () => {
    const entries = [{ id: 'track', playlistEntryId: 'entry-a' }, { id: 'track', playlistEntryId: 'entry-b' }] as Track[]
    expect((await collectSelection({ playlistId: 'set' }, vi.fn().mockResolvedValue({ items: entries, total: 2 }))).map(trackRowId)).toEqual(['entry-a', 'entry-b'])
    expect(uniqueTrackIds(entries)).toEqual(['track'])
    expect(trackRowId({ id: 'library-track' } as Track)).toBe('library-track')
  })
  it('collects every page and retains playlist and filter scope', async () => {
    const list = vi.fn().mockResolvedValueOnce({ items: rows(0, 1000), total: 1205 })
      .mockResolvedValueOnce({ items: rows(1000, 205), total: 1205 })
    const selected = await collectSelection({ playlistId: 'set', search: 'Olive', sort: '-added', page: 8 }, list)
    expect(selected).toHaveLength(1205)
    expect(selected.at(-1)?.id).toBe('1204')
    expect(list.mock.calls.map(([q]) => q)).toEqual([
      { playlistId: 'set', search: 'Olive', sort: '-added', page: 1, size: 1000 },
      { playlistId: 'set', search: 'Olive', sort: '-added', page: 2, size: 1000 },
    ])
  })
  it('does not silently accept duplicate rows or a changed result count', async () => {
    const duplicate = vi.fn().mockResolvedValueOnce({ items: rows(0, 1000), total: 1001 })
      .mockResolvedValueOnce({ items: rows(999, 1), total: 1001 })
    await expect(collectSelection({}, duplicate)).rejects.toThrow('library changed')
    const changing = vi.fn().mockResolvedValueOnce({ items: rows(0, 1000), total: 1001 })
      .mockResolvedValueOnce({ items: rows(1000, 1), total: 1002 })
    await expect(collectSelection({}, changing)).rejects.toThrow('library changed')
  })
  it('cancels across scope changes and propagates page errors without a partial selection', async () => {
    const abort = new AbortController()
    const list = vi.fn(async () => { abort.abort(); return { items: rows(0, 1000), total: 1100 } as TrackPage })
    await expect(collectSelection({}, list, abort.signal)).rejects.toThrow()
    expect(list).toHaveBeenCalledTimes(1)
    await expect(collectSelection({}, vi.fn().mockRejectedValue(new Error('Offline')))).rejects.toThrow('Offline')
  })
  it('supports empty results and invalidates scope for playlist/filter changes, not page changes', async () => {
    expect(await collectSelection({}, vi.fn().mockResolvedValue({ items: [], total: 0 }))).toEqual([])
    expect(selectionScope({ playlistId: 'a', page: 1 })).toBe(selectionScope({ playlistId: 'a', page: 2 }))
    expect(selectionScope({ playlistId: 'a' })).not.toBe(selectionScope({ playlistId: 'b' }))
    expect(selectionScope({ search: 'a' })).not.toBe(selectionScope({ search: 'b' }))
  })
})

describe('prep split sizing', () => {
  it('reserves list space, bounds dragging and recovers invalid stored dimensions', () => {
    expect(prepHeight(1000, 600)).toBe(340)
    expect(prepHeight(20, 800)).toBe(100)
    expect(prepHeight(400, 900)).toBe(400)
    expect(prepHeight(Number.NaN, 800)).toBe(340)
    expect(prepHeight(600, 500)).toBe(240)
  })
})
