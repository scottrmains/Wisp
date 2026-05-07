import { apiGet, apiPost } from './client'
import type { MixPlan, MixPlanSummary, MixPlanTrack } from './types'

async function apiSend<T>(method: 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const b = (await res.json()) as { message?: string }
      if (b.message) msg = b.message
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const mixPlans = {
  list: () => apiGet<MixPlanSummary[]>('/api/mix-plans'),
  get: (id: string) => apiGet<MixPlan>(`/api/mix-plans/${id}`),
  create: (name: string, notes?: string) =>
    apiPost<MixPlanSummary>('/api/mix-plans', { name, notes: notes ?? null }),
  update: (id: string, body: { name?: string; notes?: string }) =>
    apiSend<MixPlanSummary>('PATCH', `/api/mix-plans/${id}`, body),
  delete: (id: string) => apiSend<void>('DELETE', `/api/mix-plans/${id}`),

  addTrack: (planId: string, trackId: string, afterMixPlanTrackId?: string | null) =>
    apiPost<MixPlanTrack>(`/api/mix-plans/${planId}/tracks`, {
      trackId,
      afterMixPlanTrackId: afterMixPlanTrackId ?? null,
    }),
  moveTrack: (planId: string, mptId: string, afterMixPlanTrackId: string | null) =>
    apiSend<MixPlanTrack>('PATCH', `/api/mix-plans/${planId}/tracks/${mptId}`, {
      // Empty GUID = "head" (insert before first); null = no move requested.
      afterMixPlanTrackId: afterMixPlanTrackId ?? '00000000-0000-0000-0000-000000000000',
    }),
  updateNotes: (planId: string, mptId: string, transitionNotes: string) =>
    apiSend<MixPlanTrack>('PATCH', `/api/mix-plans/${planId}/tracks/${mptId}`, {
      transitionNotes,
    }),
  removeTrack: (planId: string, mptId: string) =>
    apiSend<void>('DELETE', `/api/mix-plans/${planId}/tracks/${mptId}`),
}
