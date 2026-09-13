import { useQuery } from '@tanstack/react-query'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { apiGet, apiPost } from '../../api/client'

export interface Annotation {
  id: string; seconds: number; endSeconds: number | null; text: string; category: string | null
  resolved: boolean; occurrenceId: string | null; toOccurrenceId: string | null; associationLabel: string | null
}
export interface Feedback {
  revision: number; notes: string; status: string; rating: number | null; ratingRevision: number; annotations: Annotation[]; detachedAnnotationIds: string[]
}
export interface CommentDraft {
  id: string; start: string; end: string; text: string; category: string; resolved: boolean
  occurrenceId: string; toOccurrenceId: string; live: boolean
}
export interface FeedbackDraft { feedback: Feedback; composer: CommentDraft | null; error: string | null; saving: boolean; saveId?: string }
export const emptyFeedback: Feedback = { revision: 0, notes: '', status: 'Practice', rating: null, ratingRevision: 0, annotations: [], detachedAnnotationIds: [] }
export const feedbackKey = (id: string) => ['recording-feedback', id]
export const useRecordingFeedback = (id: string) => useQuery({ queryKey: feedbackKey(id), queryFn: () => apiGet<Feedback>(`/api/recording-feedback/${id}`) })

// Local drafts are not saved reviews. They survive navigation/reload and failed requests.
export const useDraftStorageWarning = create<{ warning: string | null }>(() => ({ warning: null }))
const draftStorage = createJSONStorage(() => ({
  getItem: (key: string) => localStorage.getItem(key),
  removeItem: (key: string) => localStorage.removeItem(key),
  setItem: (key: string, value: string) => {
    try { localStorage.setItem(key, value); useDraftStorageWarning.setState({ warning: null }) }
    catch { useDraftStorageWarning.setState({ warning: 'Local draft storage is unavailable or full. Changes remain in this session only—save feedback before closing or reloading WISP.' }) }
  },
}))
export const useFeedbackDrafts = create<{ drafts: Record<string, FeedbackDraft>; put: (id: string, draft: FeedbackDraft) => void; discard: (id: string) => void }>()(persist(set => ({
  drafts: {},
  put: (id, draft) => set(state => ({ drafts: { ...state.drafts, [id]: draft } })),
  discard: id => set(state => ({ drafts: Object.fromEntries(Object.entries(state.drafts).filter(([key]) => key !== id)) })),
}), { name: 'wisp.recordingFeedbackDrafts', storage: draftStorage,
  onRehydrateStorage: () => (_state, error) => { if (error) useDraftStorageWarning.setState({ warning: 'Local feedback drafts could not be restored. Saved server feedback is unchanged.' }) },
  partialize: state => ({ drafts: Object.fromEntries(Object.entries(state.drafts).map(([id, draft]) => [id, { ...draft, saving: false }])) }) }))

export async function saveFeedback(id: string, feedback: Feedback, liveAnnotationId?: string): Promise<boolean> {
  const state = useFeedbackDrafts.getState(); const draft = state.drafts[id]
  if (!draft || draft.saving) return false
  const saveId = crypto.randomUUID()
  state.put(id, { ...draft, saving: true, error: null, saveId })
  try {
    await apiPost(`/api/recording-feedback/${id}`, { ...feedback, liveAnnotationId })
    if (useFeedbackDrafts.getState().drafts[id]?.saveId === saveId) state.discard(id)
    return true
  } catch (error) {
    const current = useFeedbackDrafts.getState().drafts[id]
    if (current?.saveId === saveId) state.put(id, { ...current, saving: false, error: error instanceof Error ? error.message : 'Feedback could not be saved.' })
    return false
  }
}

export interface RevisionSelection { sourceEntryId: string; trackId: string | null; omit: boolean }
export interface RevisionRequest {
  requestId: string; name: string; source: 'actual' | 'blueprint'; snapshotId: string | null
  tracklistRevision: number; feedbackRevision: number; entries: RevisionSelection[]; annotationIds: string[]
  includeOverallNotes: boolean; excludeDrafts: boolean; previewToken?: string
}
export interface RevisionPreview {
  token: string; tracks: { sourceEntryId: string; trackId: string; artist: string; title: string; cueInSeconds: number | null; cueOutSeconds: number | null; isAnchor: boolean; transitionNotes: string | null }[]
  notes: string; problems: string[]; warnings: string[]; excludedDrafts: number
}
