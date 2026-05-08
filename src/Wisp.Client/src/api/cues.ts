import { apiDelete, apiGet, apiPatch, apiPost } from './client'
import type { CuePoint, CuePointType } from './types'

export const cues = {
  list: (trackId: string) => apiGet<CuePoint[]>(`/api/tracks/${trackId}/cues`),

  create: (
    trackId: string,
    body: { timeSeconds: number; type: CuePointType; label?: string; isAutoSuggested?: boolean },
  ) => apiPost<CuePoint>(`/api/tracks/${trackId}/cues`, body),

  update: (
    id: string,
    body: { timeSeconds?: number; label?: string; type?: CuePointType },
  ) => apiPatch<CuePoint>(`/api/cues/${id}`, body),

  delete: (id: string) => apiDelete(`/api/cues/${id}`),

  deleteAll: (trackId: string) => apiDelete<{ deleted: number }>(`/api/tracks/${trackId}/cues`),

  generatePhraseMarkers: (
    trackId: string,
    body: { firstBeatSeconds: number; stepBeats?: number; replaceExisting?: boolean },
  ) => apiPost<CuePoint[]>(`/api/tracks/${trackId}/cues/phrase-markers`, body),
}
