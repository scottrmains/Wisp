import { apiGet, apiPut, ApiError } from './client'
import type { Track } from './types'

export interface LoudnessMeasurement { integratedLufs: number; truePeakDb: number; loudnessRange: number; durationSeconds: number }
export interface LoudnessState {
  track: Track
  originalPath: string
  originalExists: boolean
  normalizedExists: boolean
  analysisStale: boolean
  analysis: { id: string; sourcePath: string; targetLufs: number; measurement: LoudnessMeasurement; scannedAt: string } | null
  normalization: { outputPath: string; targetLufs: number; gainDb: number; limited: boolean; measurement: LoudnessMeasurement; createdAt: string;
    boostOnly?: boolean; referenceTrackId?: string | null; referenceTitle?: string | null } | null
}

async function post<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  if (!res.ok) {
    const error = await res.json().catch(() => ({})) as { message?: string; code?: string }
    throw new ApiError(error.message ?? `Request failed (HTTP ${res.status}).`, res.status, error.code)
  }
  return res.json() as Promise<T>
}

export const loudness = {
  settings: () => apiGet<{ musicFolder: string | null; available: boolean; outputFolderName: string }>('/api/loudness/settings'),
  status: (ids: string[], signal: AbortSignal) => post<LoudnessState[]>('/api/loudness/status', { trackIds: ids }, signal),
  scan: (id: string, targetLufs: number, signal: AbortSignal) => post<LoudnessState>(`/api/tracks/${id}/loudness/scan`, { targetLufs }, signal),
  create: (id: string, analysisId: string, musicFolder: string, allowLimiting: boolean, signal: AbortSignal,
    options: { boostOnly: boolean; referenceTrackId?: string; referenceAnalysisId?: string }) =>
    post<LoudnessState>(`/api/tracks/${id}/loudness/create`, { analysisId, musicFolder, allowLimiting, ...options }, signal),
  switch: (id: string, version: 'original' | 'normalized', expectedFilePath: string) =>
    apiPut<LoudnessState>(`/api/tracks/${id}/loudness/version`, { version, expectedFilePath }),
}

export const safeGain = (row: LoudnessState) => row.analysis
  ? Math.min(row.analysis.targetLufs - row.analysis.measurement.integratedLufs, -1.2 - row.analysis.measurement.truePeakDb) : null

export function loudnessPlan(row: LoudnessState, boostOnly: boolean, allowLimiting: boolean) {
  if (!row.analysis) return null
  const requestedGainDb = row.analysis.targetLufs - row.analysis.measurement.integratedLufs
  const safe = safeGain(row)!
  if (boostOnly && requestedGainDb <= 0.5) return { requestedGainDb, gainDb: 0, limited: false, action: 'unchanged', canCreate: false }
  const limited = allowLimiting && safe < requestedGainDb - 0.05
  if (boostOnly && !limited && safe <= 0.05) return { requestedGainDb, gainDb: 0, limited: false, action: 'needs-limiting', canCreate: false }
  const gainDb = limited ? requestedGainDb : safe
  const action = limited ? 'limit' : Math.abs(gainDb) <= 0.05 ? 'unchanged' : gainDb < 0 ? 'reduce' : safe < requestedGainDb - 0.05 ? 'partial-boost' : 'boost'
  return { requestedGainDb, gainDb, limited, action, canCreate: action !== 'unchanged' }
}
