import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AppPage = 'library' | 'mix-plans' | 'rediscover' | 'crate-digger'

interface CurrentPageState {
  page: AppPage
  setPage: (page: AppPage) => void
}

/// Active section the user is viewing. Persisted so a reload returns to the
/// last page rather than dropping the user back on Library every time.
export const useCurrentPage = create<CurrentPageState>()(
  persist(
    (set) => ({
      page: 'library',
      setPage: (page) => set({ page }),
    }),
    { name: 'wisp.currentPage' },
  ),
)
