import { apiGet, apiPost } from './client'
import type { DiscoverSearchResponse } from './types'

export interface FollowArtistResponse {
  id: string
  name: string
  spotifyArtistId: string
}

export const discover = {
  /// Searches Spotify (artists) and YouTube (videos) in parallel. `sources`
  /// is comma-delimited; pass an empty string to disable both. Server-side
  /// caching means a repeated query within a UTC day doesn't re-burn YT
  /// quota.
  search: (query: string, sources: string = 'spotify,youtube') =>
    apiGet<DiscoverSearchResponse>('/api/discover/search', { q: query, sources }),

  /// Creates an ArtistProfile (or attaches to an existing one with the same
  /// normalized name) and runs an initial Spotify refresh so the user sees
  /// recent releases right away. Idempotent — clicking Follow on the same
  /// artist twice returns the same row.
  follow: (body: { name: string; spotifyArtistId: string; imageUrl?: string }) =>
    apiPost<FollowArtistResponse>('/api/discover/follow', body),
}
