import { apiGet } from './client'
import type { DiscoverSearchResponse } from './types'

export const discover = {
  /// Searches Spotify (artists) and YouTube (videos) in parallel. `sources`
  /// is comma-delimited; pass an empty string to disable both. Server-side
  /// caching means a repeated query within a UTC day doesn't re-burn YT
  /// quota.
  search: (query: string, sources: string = 'spotify,youtube') =>
    apiGet<DiscoverSearchResponse>('/api/discover/search', { q: query, sources }),
}
