import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppPage = 'library' | 'mix-plans' | 'rediscover' | 'crate-digger'

interface CurrentPageState {
  page: AppPage
  setPage: (page: AppPage) => void

  /// Library's TrackPrepWorkspace publishes whether it's currently showing.
  /// Used by App.tsx to suppress the redundant MiniPlayer when the workspace
  /// owns playback chrome on the same page. Session-scoped (not persisted).
  libraryWorkspaceActive: boolean
  setLibraryWorkspaceActive: (active: boolean) => void
}

/// Active section the user is viewing. Persisted so a reload returns to the
/// last page rather than dropping the user back on Library every time.
export const useCurrentPage = create<CurrentPageState>()(
  persist(
    (set) => ({
      page: 'library',
      setPage: (page) => set({ page }),

      libraryWorkspaceActive: false,
      setLibraryWorkspaceActive: (active) => set({ libraryWorkspaceActive: active }),
    }),
    {
      name: 'wisp.currentPage',
      // Only `page` is persisted — workspace-active is session state.
      partialize: (s) => ({ page: s.page }),
    },
  ),
)
