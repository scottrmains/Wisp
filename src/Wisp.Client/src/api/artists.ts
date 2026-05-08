import { apiGet, apiPatch, apiPost } from './client'
import type { ArtistCandidate, ArtistSummary, CatalogSource, ExternalRelease } from './types'

export const artists = {
  list: () => apiGet<ArtistSummary[]>('/api/artists'),
  matchCandidates: (id: string, source: CatalogSource) =>
    apiGet<ArtistCandidate[]>(`/api/artists/${id}/match-candidates`, { source }),
  assignMatch: (id: string, source: CatalogSource, externalId: string) =>
    apiPost<{
      id: string
      spotifyArtistId: string | null
      discogsArtistId: string | null
      youTubeChannelId: string | null
    }>(`/api/artists/${id}/match`, { source, externalId }),
  refresh: (id: string) => apiPost<{ inserted: number }>(`/api/artists/${id}/refresh`),
  releases: (id: string, status?: 'new' | 'dismissed' | 'saved' | 'library') =>
    apiGet<ExternalRelease[]>(`/api/artists/${id}/releases`, { status }),
  updateRelease: (id: string, body: { isDismissed?: boolean; isSavedForLater?: boolean }) =>
    apiPatch<ExternalRelease>(`/api/releases/${id}`, body),
}
