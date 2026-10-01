import { create } from 'zustand'

export const useMusicAnalysis = create<{
  ids: string[]
  open: boolean
  jobId: string | null
  dismissedJobId: string | null
  show: (ids?: string[]) => void
  hide: () => void
  setJob: (id: string) => void
  dismiss: () => void
}>((set) => ({
  ids: [],
  open: false,
  jobId: null,
  dismissedJobId: null,
  show: (ids) => set((s) => ({ open: true, ids: ids ? [...new Set(ids)] : s.ids })),
  hide: () => set({ open: false }),
  setJob: (id) => set({ jobId: id, dismissedJobId: null }),
  dismiss: () => set((s) => ({ jobId: null, dismissedJobId: s.jobId })),
}))
