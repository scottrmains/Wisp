import { create } from 'zustand'

/// A relink keeps the track ID but changes its audio identity. Every deck and
/// waveform observes this revision; old in-flight peaks stay under their old key.
export const useAudioFiles = create<{ revisions: Record<string, number>; refresh: (id: string) => void }>((set) => ({
  revisions: {},
  refresh: (id) => set((s) => ({ revisions: { ...s.revisions, [id]: (s.revisions[id] ?? 0) + 1 } })),
}))

export const audioKey = (id: string) => `${id}:${useAudioFiles.getState().revisions[id] ?? 0}`
export const audioUrl = (id: string) => `/api/tracks/${id}/audio?v=${useAudioFiles.getState().revisions[id] ?? 0}`

export async function audioResponseError(res: Response): Promise<string> {
  try {
    const body = await res.json() as { message?: string; detail?: string }
    if (body.message) return body.message
    if (body.detail) return body.detail
  } catch { /* A proxy or disconnected backend may not return JSON. */ }
  if (res.status === 410) return 'Audio file not found. Connect its drive or relink this track.'
  if (res.status === 404) return 'This track is no longer in WISP.'
  return `Audio could not be loaded (HTTP ${res.status}). Try again or relink the file.`
}
