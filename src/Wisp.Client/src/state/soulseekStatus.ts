import { create } from 'zustand'

interface SoulseekStatusState {
  /// Drives whether the global transfers query polls. Anyone who queues a download
  /// flips this to true; the polling loop flips it back to false once nothing's
  /// in flight (auto-detected from the transfer list).
  pollingActive: boolean
  ensurePolling: () => void
  stopPolling: () => void

  /// Lets the user dismiss the AppHeader indicator after their downloads complete.
  /// Reset whenever a fresh transfer is queued so the next batch shows up again.
  dismissedAt: number | null
  dismiss: () => void
  resetDismiss: () => void
}

/// Soulseek download status that needs to live above any single page so the
/// AppHeader pill keeps updating regardless of which section the user is on.
export const useSoulseekStatus = create<SoulseekStatusState>((set) => ({
  pollingActive: false,
  ensurePolling: () => set({ pollingActive: true, dismissedAt: null }),
  stopPolling: () => set({ pollingActive: false }),

  dismissedAt: null,
  dismiss: () => set({ dismissedAt: Date.now() }),
  resetDismiss: () => set({ dismissedAt: null }),
}))
