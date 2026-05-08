import { apiGet, apiPost, apiPut } from './client'
import type {
  Recommendation,
  RecommendationMode,
  ScanJob,
  ScanProgress,
  Track,
  TrackPage,
  TrackQuery,
} from './types'

export const library = {
  startScan: (folderPath: string) => apiPost<ScanJob>('/api/library/scan', { folderPath }),
  getScan: (id: string) => apiGet<ScanJob>(`/api/library/scan/${id}`),
}

export const tracks = {
  list: (q: TrackQuery = {}) => {
    // `tag` is an array — apiGet's query-string helper only handles scalars, so flatten manually.
    const { tag, ...rest } = q
    const url = new URL('/api/tracks', window.location.origin)
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined || v === null || v === '') continue
      url.searchParams.set(k, String(v))
    }
    if (tag) for (const t of tag) url.searchParams.append('tag', t)
    return apiGet<TrackPage>(url.pathname + url.search)
  },
  get: (id: string) => apiGet<Track>(`/api/tracks/${id}`),
  recommendations: (id: string, opts: {
    mode?: RecommendationMode
    limit?: number
    /// Restricts the candidate pool to tracks that are members of the given playlist.
    /// Set automatically by the Mix Plans page when the active plan has a scope.
    scopePlaylistId?: string
  } = {}) =>
    apiGet<Recommendation[]>(`/api/tracks/${id}/recommendations`, {
      mode: opts.mode ?? 'Safe',
      limit: opts.limit ?? 50,
      scopePlaylistId: opts.scopePlaylistId,
    }),
  updateNotes: (id: string, notes: string | null) =>
    apiPut<Track>(`/api/tracks/${id}/notes`, { notes }),
  archive: (id: string, reason: string) =>
    apiPost<Track>(`/api/tracks/${id}/archive`, { reason }),
  restore: (id: string) =>
    apiPost<Track>(`/api/tracks/${id}/restore`),
}

/// EventSource wrapper that surfaces typed scan progress events.
/// Returns a teardown function. Call it to close the stream.
export function subscribeToScan(
  scanJobId: string,
  handlers: {
    onProgress: (p: ScanProgress) => void
    onError?: (err: Event) => void
    onComplete?: (p: ScanProgress) => void
  },
): () => void {
  const source = new EventSource(`/api/library/scan/${scanJobId}/events`)
  source.onmessage = (e) => {
    try {
      const p = JSON.parse(e.data) as ScanProgress
      handlers.onProgress(p)
      if (p.status === 'Completed' || p.status === 'Failed' || p.status === 'Cancelled') {
        handlers.onComplete?.(p)
        source.close()
      }
    } catch (err) {
      console.error('SSE: failed to parse', err, e.data)
    }
  }
  source.onerror = (e) => {
    handlers.onError?.(e)
  }
  return () => source.close()
}
