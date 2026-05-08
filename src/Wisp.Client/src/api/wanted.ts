import { apiDelete, apiGet, apiPost } from './client'
import type { CreateWantedTrackRequest, WantedTrack } from './types'

export const wanted = {
  list: () => apiGet<WantedTrack[]>('/api/wanted-tracks'),
  create: (body: CreateWantedTrackRequest) =>
    apiPost<WantedTrack>('/api/wanted-tracks', body),
  delete: (id: string) => apiDelete(`/api/wanted-tracks/${id}`),
}
