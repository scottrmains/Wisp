import { apiGet, apiPost } from './client'
import type { ScanJob, ScanProgress, Track, TrackPage, TrackQuery } from './types'

export const library = {
  startScan: (folderPath: string) => apiPost<ScanJob>('/api/library/scan', { folderPath }),
  getScan: (id: string) => apiGet<ScanJob>(`/api/library/scan/${id}`),
}

export const tracks = {
  list: (q: TrackQuery = {}) => apiGet<TrackPage>('/api/tracks', q as Record<string, unknown>),
  get: (id: string) => apiGet<Track>(`/api/tracks/${id}`),
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
