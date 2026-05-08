import { apiDelete, apiGet, apiPost } from './client'
import type {
  DigitalMatch,
  DiscoveredTrack,
  DiscoveredTrackPage,
  DiscoveryScanProgress,
  DiscoverySource,
  DiscoveryStatus,
} from './types'

export const discovery = {
  // sources
  listSources: () => apiGet<DiscoverySource[]>('/api/discovery/sources'),
  createSource: (url: string) => apiPost<DiscoverySource>('/api/discovery/sources', { url }),
  deleteSource: (id: string) => apiDelete(`/api/discovery/sources/${id}`),
  scanSource: (id: string) => apiPost<void>(`/api/discovery/sources/${id}/scan`),
  listTracks: (
    id: string,
    opts: { status?: DiscoveryStatus; search?: string; page?: number; size?: number } = {},
  ) =>
    apiGet<DiscoveredTrackPage>(
      `/api/discovery/sources/${id}/tracks`,
      opts as Record<string, unknown>,
    ),

  // tracks
  getTrack: (id: string) =>
    apiGet<{ track: DiscoveredTrack; matches: DigitalMatch[] }>(`/api/discovery/tracks/${id}`),
  updateParse: (
    id: string,
    body: { artist?: string | null; title?: string | null; version?: string | null; year?: number | null },
  ) => apiPost<DiscoveredTrack>(`/api/discovery/tracks/${id}/parse`, body),
  updateStatus: (id: string, status: DiscoveryStatus) =>
    apiPost<DiscoveredTrack>(`/api/discovery/tracks/${id}/status`, { status }),
  match: (id: string) => apiPost<{ ok: boolean }>(`/api/discovery/tracks/${id}/match`),
}

export function subscribeToDiscoveryScan(
  sourceId: string,
  handlers: {
    onProgress: (p: DiscoveryScanProgress) => void
    onComplete?: (p: DiscoveryScanProgress) => void
    onError?: (err: Event) => void
  },
): () => void {
  const source = new EventSource(`/api/discovery/sources/${sourceId}/scan/events`)
  source.onmessage = (e) => {
    try {
      const p = JSON.parse(e.data) as DiscoveryScanProgress
      handlers.onProgress(p)
      if (p.status === 'Completed' || p.status === 'Failed' || p.status === 'Cancelled') {
        handlers.onComplete?.(p)
        source.close()
      }
    } catch (err) {
      console.error('Discovery SSE: failed to parse', err)
    }
  }
  source.onerror = (e) => handlers.onError?.(e)
  return () => source.close()
}
