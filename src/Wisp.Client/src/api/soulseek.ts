import { apiDelete, apiGet, apiPost, apiPut } from './client'
import type { SoulseekSearchResult, SoulseekTransfer } from './types'

export const soulseek = {
  startSearch: (query: string) => apiPost<{ id: string }>('/api/soulseek/searches', { query }),
  getSearch: (id: string) => apiGet<SoulseekSearchResult>(`/api/soulseek/searches/${id}`),
  stopSearch: (id: string) => apiPost<void>(`/api/soulseek/searches/${id}/stop`),
  deleteSearch: (id: string) => apiDelete(`/api/soulseek/searches/${id}`),
  connection: () => apiGet<SoulseekConnection>('/api/soulseek/connection'),
  reconnect: () => apiPost<void>('/api/soulseek/reconnect'),
  sharing: () => apiGet<{ settings: SharingSettings; canConfigure: boolean; restartRequired: boolean }>('/api/soulseek/sharing'),
  saveSharing: (settings: SharingSettings) => apiPut<{ message: string }>('/api/soulseek/sharing', settings),
  shares: () => apiGet<SoulseekShare[]>('/api/soulseek/shares'),
  shareStatus: () => apiGet<{ scanning: boolean; scanPending: boolean; ready: boolean; faulted: boolean; scanProgress: number; files: number } | null>('/api/soulseek/shares/status'),
  rescanShares: () => apiPost<void>('/api/soulseek/shares/rescan'),
  uploads: () => apiGet<SoulseekTransfer[]>('/api/soulseek/uploads'),
  cancelUpload: (transfer: Pick<SoulseekTransfer, 'id' | 'username'>) => apiPost<void>('/api/soulseek/uploads/cancel', transfer),
  download: (username: string, filename: string, size: number) =>
    apiPost<{ ok: boolean }>('/api/soulseek/downloads', { username, filename, size }),
  listDownloads: () => apiGet<SoulseekTransfer[]>('/api/soulseek/downloads'),
  cancelDownload: (transfer: Pick<SoulseekTransfer, 'id' | 'username'>) =>
    apiPost<void>('/api/soulseek/downloads/cancel', { id: transfer.id, username: transfer.username }),
  retryDownload: (transfer: Pick<SoulseekTransfer, 'id' | 'username'>) => apiPost<void>('/api/soulseek/downloads/retry', transfer),
  retryImport: (transfer: Pick<SoulseekTransfer, 'id' | 'username'>) => apiPost<void>('/api/soulseek/downloads/import', transfer),
  clearDownloads: (transfer?: Pick<SoulseekTransfer, 'id' | 'username'>) =>
    apiPost<{ clearedIds: string[]; skipped: number; errors: string[] }>('/api/soulseek/downloads/clear',
      transfer ? { id: transfer.id, username: transfer.username } : {}),
}

export interface SoulseekConnection {
  isConfigured: boolean; daemonAvailable: boolean; isConnected: boolean; isLoggedIn: boolean
  isTransitioning: boolean; username: string | null; message: string | null
}
export interface SharingSettings { enabled: boolean; folders: string[] | null; uploadSlots: number; uploadSpeedLimit: number }
export interface SoulseekShare { id: string; alias: string; localPath: string; isExcluded: boolean; files: number | null }
