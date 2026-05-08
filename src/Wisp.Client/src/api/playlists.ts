import { apiDelete, apiGet, apiPost } from './client'
import type { Playlist, PlaylistSummary, PlaylistTrack } from './types'

async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'PATCH',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const b = (await res.json()) as { message?: string }
      if (b.message) msg = b.message
    } catch { /* swallow */ }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const playlists = {
  list: () => apiGet<PlaylistSummary[]>('/api/playlists'),
  get: (id: string) => apiGet<Playlist>(`/api/playlists/${id}`),
  create: (name: string, notes?: string) =>
    apiPost<PlaylistSummary>('/api/playlists', { name, notes: notes ?? null }),
  update: (id: string, body: { name?: string; notes?: string }) =>
    apiPatch<PlaylistSummary>(`/api/playlists/${id}`, body),
  delete: (id: string) => apiDelete<void>(`/api/playlists/${id}`),
  addTrack: (playlistId: string, trackId: string) =>
    apiPost<PlaylistTrack>(`/api/playlists/${playlistId}/tracks`, { trackId }),
  addTracksBulk: (playlistId: string, trackIds: string[]) =>
    apiPost<{ added: number; skipped: number }>(`/api/playlists/${playlistId}/tracks/bulk`, { trackIds }),
  removeTrack: (playlistId: string, trackId: string) =>
    apiDelete<void>(`/api/playlists/${playlistId}/tracks/${trackId}`),
}
