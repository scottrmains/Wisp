import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ActivePlaylistState {
  /// Currently-scoping playlist for the Library page. When non-null, the library
  /// table only shows tracks that are members of this playlist. Null = full library.
  /// Persisted so the scope survives reloads (matches how `currentPage` works).
  activePlaylistId: string | null
  setActivePlaylistId: (id: string | null) => void
}

export const useActivePlaylist = create<ActivePlaylistState>()(
  persist(
    (set) => ({
      activePlaylistId: null,
      setActivePlaylistId: (id) => set({ activePlaylistId: id }),
    }),
    { name: 'wisp.activePlaylist' },
  ),
)
