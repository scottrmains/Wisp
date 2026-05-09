import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type InspectorTab = 'overview' | 'recommendations' | 'cues' | 'metadata' | 'notes' | 'tags'

interface UiPrefsState {
  /// Inspector width in pixels. Persisted across launches.
  inspectorWidth: number
  setInspectorWidth: (px: number) => void

  /// Whether the inspector pane is collapsed (icon-only / hidden body).
  /// Independent from "no track selected" — the user can collapse with a row selected.
  inspectorCollapsed: boolean
  setInspectorCollapsed: (collapsed: boolean) => void
  toggleInspectorCollapsed: () => void

  /// Last tab the user landed on. Per-session memory so re-selecting a track
  /// keeps you where you were.
  lastInspectorTab: InspectorTab
  setLastInspectorTab: (tab: InspectorTab) => void

  /// Whether the App-level sidebar is collapsed to icons-only.
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void

  /// Discover "Anywhere" search source toggles. Persisted so power users
  /// who want Spotify-only (saves YouTube quota) keep that pref across
  /// sessions.
  discoverSpotifyEnabled: boolean
  discoverYouTubeEnabled: boolean
  toggleDiscoverSource: (source: 'spotify' | 'youtube') => void

  /// Soulseek dialog filter prefs. Default to MP3 320 because that's the
  /// DJ-deck-friendly format the user explicitly picks; persisted so the
  /// preferred filter applies on every search without re-toggling.
  slskdFormat: 'any' | 'mp3' | 'flac' | 'wav'
  slskdMp3Bitrate: 'any' | '320' | '256+'
  slskdHideLocked: boolean
  slskdFreeSlotsOnly: boolean
  setSlskdFilter: (next: Partial<{
    slskdFormat: 'any' | 'mp3' | 'flac' | 'wav'
    slskdMp3Bitrate: 'any' | '320' | '256+'
    slskdHideLocked: boolean
    slskdFreeSlotsOnly: boolean
  }>) => void
}

const MIN_WIDTH = 280
const MAX_WIDTH = 720
const DEFAULT_WIDTH = 448

export const useUiPrefs = create<UiPrefsState>()(
  persist(
    (set) => ({
      inspectorWidth: DEFAULT_WIDTH,
      setInspectorWidth: (px) =>
        set({ inspectorWidth: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px))) }),

      inspectorCollapsed: false,
      setInspectorCollapsed: (collapsed) => set({ inspectorCollapsed: collapsed }),
      toggleInspectorCollapsed: () =>
        set((s) => ({ inspectorCollapsed: !s.inspectorCollapsed })),

      lastInspectorTab: 'overview',
      setLastInspectorTab: (tab) => set({ lastInspectorTab: tab }),

      sidebarCollapsed: false,
      toggleSidebarCollapsed: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      // YouTube default-on per Phase 22 decision; quota meter signals when
      // it's running low so the user knows whether to flip it off.
      discoverSpotifyEnabled: true,
      discoverYouTubeEnabled: true,
      toggleDiscoverSource: (source) =>
        set((s) =>
          source === 'spotify'
            ? { discoverSpotifyEnabled: !s.discoverSpotifyEnabled }
            : { discoverYouTubeEnabled: !s.discoverYouTubeEnabled },
        ),

      // Soulseek filter defaults — MP3 320 is the DJ-deck sweet spot, hide
      // locked files (share-ratio gated) by default since they need a
      // share to download anyway.
      slskdFormat: 'mp3',
      slskdMp3Bitrate: '320',
      slskdHideLocked: true,
      slskdFreeSlotsOnly: false,
      setSlskdFilter: (next) => set((s) => ({ ...s, ...next })),
    }),
    {
      name: 'wisp.uiPrefs',
      // Only the persistent width + collapsed toggle should hit localStorage —
      // the last-used tab is intentionally session-y, but persisting it is harmless and small.
    },
  ),
)
