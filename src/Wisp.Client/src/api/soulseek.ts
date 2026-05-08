import { apiGet, apiPost } from './client'
import type { SoulseekSearchResult, SoulseekTransfer } from './types'

export const soulseek = {
  startSearch: (query: string) => apiPost<{ id: string }>('/api/soulseek/searches', { query }),
  getSearch: (id: string) => apiGet<SoulseekSearchResult>(`/api/soulseek/searches/${id}`),
  download: (username: string, filename: string, size: number) =>
    apiPost<{ ok: boolean }>('/api/soulseek/downloads', { username, filename, size }),
  listDownloads: () => apiGet<SoulseekTransfer[]>('/api/soulseek/downloads'),
}
