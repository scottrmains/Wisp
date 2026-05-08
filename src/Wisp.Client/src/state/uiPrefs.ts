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
    }),
    {
      name: 'wisp.uiPrefs',
      // Only the persistent width + collapsed toggle should hit localStorage —
      // the last-used tab is intentionally session-y, but persisting it is harmless and small.
    },
  ),
)
