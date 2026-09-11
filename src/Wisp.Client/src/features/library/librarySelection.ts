import type { Track, TrackPage, TrackQuery } from '../../api/types'

export const trackRowId = (track: Track): string => track.playlistEntryId ?? track.id
export const uniqueTrackIds = (rows: Track[]): string[] => [...new Set(rows.map(t => t.id))]

/// Resolve the complete filtered result, not just the rendered/virtualised page.
/// Refuse an inconsistent snapshot rather than silently omitting tracks.
export async function collectSelection(query: TrackQuery, list: (query: TrackQuery, signal?: AbortSignal) => Promise<TrackPage>, signal?: AbortSignal): Promise<Track[]> {
  const result = new Map<string, Track>()
  let expected: number | undefined
  for (let page = 1; ; page++) {
    signal?.throwIfAborted()
    const batch = await list({ ...query, page, size: 1000 }, signal)
    expected ??= batch.total
    if (batch.total !== expected) throw new Error('The library changed while selecting tracks. Please try Select all again.')
    for (const track of batch.items) result.set(trackRowId(track), track)
    if (page * 1000 >= expected) break
    if (!batch.items.length) throw new Error('The complete selection could not be loaded. Please try again.')
  }
  signal?.throwIfAborted()
  if (result.size !== expected) throw new Error('The library changed while selecting tracks. Please try Select all again.')
  return [...result.values()]
}

export function selectionScope(query: TrackQuery): string {
  // Page changes do not discard a deliberate multi-page selection.
  const { page: _page, size: _size, ...scope } = query
  void _page; void _size
  return JSON.stringify(scope)
}

export function prepHeight(requested: number, available: number, reserved = 260): number {
  const max = Math.max(100, Math.min(available * 0.65, available - reserved))
  return Math.round(Math.max(100, Math.min(max, Number.isFinite(requested) ? requested : 340)))
}
