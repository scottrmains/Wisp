import { apiGet, apiPost } from './client'

export interface MusicAnalysis {
  bpm: number | null
  key: string | null
  tempoStrength: number
  keyStrength: number
  tempoUncertain: boolean
  keyUncertain: boolean
  seconds: number
  engine: string
}
export interface AnalysisRow {
  trackId: string
  title: string
  status: string
  message: string | null
  existingBpm: number | null
  existingKey: string | null
  result: MusicAnalysis | null
  cached: boolean
  bpmRequested: boolean
  keyRequested: boolean
}
export interface AnalysisJob {
  id: string
  status: string
  rows: AnalysisRow[]
}
export const musicAnalysis = {
  status: () =>
    apiGet<{ available: boolean; activeJob: Pick<AnalysisJob, 'id' | 'status'> | null }>(
      '/api/audio-analysis/status',
    ),
  job: (id: string) => apiGet<AnalysisJob>(`/api/audio-analysis/jobs/${id}`),
  start: (trackIds: string[], bpm: boolean, key: boolean, compareExisting: boolean) =>
    apiPost<AnalysisJob>('/api/audio-analysis/jobs', { trackIds, bpm, key, compareExisting }),
  cancel: (id: string) => apiPost<void>(`/api/audio-analysis/jobs/${id}/cancel`),
  apply: (id: string, trackId: string, bpm: number | null, key: string | null) =>
    apiPost<{ bpmApplied: boolean; keyApplied: boolean; message: string }>(
      `/api/audio-analysis/jobs/${id}/tracks/${trackId}/apply`,
      { bpm, key },
    ),
}
export const analysisRunning = (status?: string) =>
  status === 'queued' || status === 'running' || status === 'cancelling'
export function analysisDraft(row: AnalysisRow) {
  return {
    bpm: row.result?.bpm?.toString() ?? '',
    useBpm:
      row.bpmRequested &&
      !!row.result?.bpm &&
      !row.result.tempoUncertain &&
      !(row.existingBpm && row.existingBpm > 0),
    useKey:
      row.keyRequested && !!row.result?.key && !row.result.keyUncertain && !row.existingKey?.trim(),
  }
}
