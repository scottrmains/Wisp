import { apiGet, apiPatch, apiPost } from './client'
import type { ArtistCandidate, ArtistSummary, ExternalRelease } from './types'

export const artists = {
  list: () => apiGet<ArtistSummary[]>('/api/artists'),
  matchCandidates: (id: string) =>
    apiGet<ArtistCandidate[]>(`/api/artists/${id}/match-candidates`),
  assignMatch: (id: string, source: string, externalId: string) =>
    apiPost<{ id: string; spotifyArtistId: string }>(`/api/artists/${id}/match`, { source, externalId }),
  refresh: (id: string) => apiPost<{ inserted: number }>(`/api/artists/${id}/refresh`),
  releases: (id: string, status?: 'new' | 'dismissed' | 'saved' | 'library') =>
    apiGet<ExternalRelease[]>(`/api/artists/${id}/releases`, { status }),
  updateRelease: (id: string, body: { isDismissed?: boolean; isSavedForLater?: boolean }) =>
    apiPatch<ExternalRelease>(`/api/releases/${id}`, body),
}
