import { apiGet, apiPost } from './client'
import type { AuditEntry, CleanupSuggestion } from './types'

export const cleanup = {
  preview: (trackId: string) => apiGet<CleanupSuggestion>(`/api/tracks/${trackId}/cleanup`),
  apply: (trackId: string) => apiPost<AuditEntry>(`/api/tracks/${trackId}/cleanup/apply`),
  audits: (trackId?: string, limit = 50) =>
    apiGet<AuditEntry[]>('/api/cleanup/audits', { trackId, limit }),
  undo: (auditId: string) => apiPost<AuditEntry>(`/api/cleanup/audits/${auditId}/undo`),
}
