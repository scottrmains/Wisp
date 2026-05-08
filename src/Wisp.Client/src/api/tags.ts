import { apiDelete, apiGet, apiPost } from './client'
import type { TagSummary, TagType, TrackTag } from './types'

export const tags = {
  forTrack: (trackId: string) => apiGet<TrackTag[]>(`/api/tracks/${trackId}/tags`),
  add: (trackId: string, name: string, type: TagType) =>
    apiPost<TrackTag>(`/api/tracks/${trackId}/tags`, { name, type }),
  remove: (trackId: string, tagId: string) =>
    apiDelete<void>(`/api/tracks/${trackId}/tags/${tagId}`),
  /// Library-wide distinct tags with their use counts. Drives the autocomplete +
  /// the tag filter pill above the library table.
  all: () => apiGet<TagSummary[]>('/api/tags'),
}
