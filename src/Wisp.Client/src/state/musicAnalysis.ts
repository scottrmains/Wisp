import { create } from 'zustand'

export const useMusicAnalysis = create<{
  ids: string[]
  open: boolean
  jobId: string | null
  dismissedJobId: string | null
  preset: 'missing-bpm' | null
  requestVersion: number
  show: (ids?: string[], preset?: 'missing-bpm') => void
  hide: () => void
  setJob: (id: string) => void
  dismiss: () => void
}>((set) => ({
  ids: [],
  open: false,
  jobId: null,
  dismissedJobId: null,
  preset: null,
  requestVersion: 0,
  show: (ids, preset) =>
    set((s) => ({
      open: true,
      ids: ids ? [...new Set(ids)] : s.ids,
      preset: ids ? (preset ?? null) : s.preset,
      requestVersion: ids ? s.requestVersion + 1 : s.requestVersion,
    })),
  hide: () => set({ open: false }),
  setJob: (id) => set({ jobId: id, dismissedJobId: null }),
  dismiss: () => set((s) => ({ jobId: null, dismissedJobId: s.jobId })),
}))
