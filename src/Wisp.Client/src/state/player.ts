import { create } from 'zustand'

/// Imperative handle the MiniPlayer publishes once its audio element is wired up.
/// Other components dispatch through `usePlayer` and the store forwards via this handle.
interface PlayerCommands {
  play: () => Promise<void>
  pause: () => void
  toggle: () => Promise<void>
  seek: (timeSeconds: number) => void
}

interface PlayerState {
  /// Currently-loaded track id; null = mini-player hidden.
  trackId: string | null
  /// Once true, MiniPlayer auto-starts on the next loadedmetadata. Cleared after consume.
  pendingPlay: boolean

  /// Mirror of the audio element's state — written by MiniPlayer, read by inspectors etc.
  isPlaying: boolean
  position: number
  duration: number

  /// Public API — anyone in the app can call these.
  playTrack: (trackId: string) => void
  loadTrack: (trackId: string) => void
  togglePlay: () => void
  seek: (timeSeconds: number) => void
  clear: () => void

  /// Internal — wired up by MiniPlayer on mount, do not call from elsewhere.
  _commands: PlayerCommands | null
  _registerCommands: (c: PlayerCommands | null) => void
  _setStatus: (s: { isPlaying: boolean; position: number; duration: number }) => void
  _consumePendingPlay: () => boolean
}

export const usePlayer = create<PlayerState>((set, get) => ({
  trackId: null,
  pendingPlay: false,
  isPlaying: false,
  position: 0,
  duration: 0,
  _commands: null,

  playTrack: (id) => {
    // Same track already loaded → just toggle/restart play.
    if (get().trackId === id) {
      const c = get()._commands
      if (c) void c.play()
      return
    }
    set({ trackId: id, pendingPlay: true, isPlaying: false, position: 0, duration: 0 })
  },
  loadTrack: (id) => {
    if (get().trackId === id) return
    set({ trackId: id, pendingPlay: false, isPlaying: false, position: 0, duration: 0 })
  },
  togglePlay: () => {
    const c = get()._commands
    if (c) void c.toggle()
  },
  seek: (t) => {
    const c = get()._commands
    if (c) c.seek(t)
  },
  clear: () => {
    const c = get()._commands
    if (c) c.pause()
    set({ trackId: null, pendingPlay: false, isPlaying: false, position: 0, duration: 0 })
  },

  _registerCommands: (c) => set({ _commands: c }),
  _setStatus: (s) => set(s),
  _consumePendingPlay: () => {
    const wanted = get().pendingPlay
    if (wanted) set({ pendingPlay: false })
    return wanted
  },
}))
