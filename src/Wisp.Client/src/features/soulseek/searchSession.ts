import { create } from 'zustand'
import type { SoulseekSearchHit } from '../../api/types'

// Session-only: keep results when navigating, without writing peer filenames
// into localStorage. Contextual searches keep their own independent state.
export interface SearchSession {
  query: string; searchId: string | null; hits: SoulseekSearchHit[]; searching: boolean
  responseCount: number; startedAt: number
}
export const useSearchSession = create<{ tab: 'search' | 'downloads' | 'sharing'; setTab: (tab: 'search' | 'downloads' | 'sharing') => void;
  queueNotice: string | null; setQueueNotice: (notice: string | null) => void;
  snapshot: SearchSession | null; save: (snapshot: SearchSession) => void }>((set) => ({
  tab: 'search', setTab: tab => set({ tab }),
  queueNotice: null, setQueueNotice: queueNotice => set({ queueNotice }),
  snapshot: null, save: snapshot => set({ snapshot }),
}))
