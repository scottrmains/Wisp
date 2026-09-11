import { apiGet, apiPost } from './client'
import type { SoulseekSearchResult, SoulseekTransfer } from './types'

export const soulseek = {
  startSearch: (query: string) => apiPost<{ id: string }>('/api/soulseek/searches', { query }),
  getSearch: (id: string) => apiGet<SoulseekSearchResult>(`/api/soulseek/searches/${id}`),
  download: (username: string, filename: string, size: number) =>
    apiPost<{ ok: boolean }>('/api/soulseek/downloads', { username, filename, size }),
  listDownloads: () => apiGet<SoulseekTransfer[]>('/api/soulseek/downloads'),
  cancelDownload: (transfer: Pick<SoulseekTransfer, 'id' | 'username'>) =>
    apiPost<void>('/api/soulseek/downloads/cancel', { id: transfer.id, username: transfer.username }),
  clearDownloads: (transfer?: Pick<SoulseekTransfer, 'id' | 'username'>) =>
    apiPost<{ clearedIds: string[]; skipped: number; errors: string[] }>('/api/soulseek/downloads/clear',
      transfer ? { id: transfer.id, username: transfer.username } : {}),
}
