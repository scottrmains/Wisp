import { lazy, Suspense, useState } from 'react'
import { useActivePlan } from './state/activePlan'
import { useCurrentPage } from './state/currentPage'
import { LibraryPage } from './features/library/LibraryPage'
import { ScanToast } from './features/library/ScanToast'
import { useScan } from './features/library/useScan'
import { ChainDock } from './features/mixchain/ChainDock'
import { MiniPlayer } from './features/player/MiniPlayer'
import { AppHeader } from './features/shell/AppHeader'
import { AppSidebar } from './features/shell/AppSidebar'
import { bridge, bridgeAvailable } from './bridge'
import { DialogHost } from './components/DialogHost'
import { RecordingInputIndicator } from './features/recordings/RecordingInputPage'
import { MixRecordingIndicator } from './features/recordings/MixRecorderPanel'

// These feature areas are not needed for first paint of the library workspace.
// Keep their dependencies out of the startup bundle and load only on navigation.
const CrateDiggerPage = lazy(() => import('./features/cratedigger/CrateDiggerPage').then((m) => ({ default: m.CrateDiggerPage })))
const MixPlansPage = lazy(() => import('./features/mixchain/MixPlansPage').then((m) => ({ default: m.MixPlansPage })))
const DiscoverPage = lazy(() => import('./features/discover/DiscoverPage').then((m) => ({ default: m.DiscoverPage })))
const WantedPage = lazy(() => import('./features/wanted/WantedPage').then((m) => ({ default: m.WantedPage })))
const SettingsPanel = lazy(() => import('./features/settings/SettingsPanel').then((m) => ({ default: m.SettingsPanel })))
const RecordingsWorkspace = lazy(() => import('./features/recordings/RecordingsWorkspace').then(m => ({ default: m.RecordingsWorkspace })))

/// App-level shell. Layout is:
///
///   ┌────────┬──────────────────────────────────┐
///   │        │ AppHeader (global actions)       │
///   │        ├──────────────────────────────────┤
///   │ Side   │                                  │
///   │ bar    │ Active page content              │
///   │        │                                  │
///   │ (nav)  ├──────────────────────────────────┤
///   │        │ ChainDock (when active plan)     │
///   │        ├──────────────────────────────────┤
///   │        │ MiniPlayer                       │
///   └────────┴──────────────────────────────────┘
///
/// Settings stays as a modal overlay (contextual panel, not a section).
function App() {
  const page = useCurrentPage((s) => s.page)
  // When LibraryPage's TrackPrepWorkspace is showing, the workspace owns the
  // playback UI for the selected track — the bottom MiniPlayer would just
  // duplicate the same controls. Hide it in that case. The mini-player still
  // renders when no row is selected, so users coming back from Mix Plans /
  // Crate Digger with a track playing don't lose visibility of it.
  const libraryWorkspaceActive = useCurrentPage((s) => s.libraryWorkspaceActive)
  const { activePlanId } = useActivePlan()
  const scan = useScan()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Chain-dock collapse lives at the App level so the user's preference survives
  // section navigation (the dock unmounts/remounts as pages change otherwise).
  const [chainCollapsed, setChainCollapsed] = useState(false)

  const pickAndScan = async () => {
    if (!bridgeAvailable()) return
    const result = await bridge.pickFolder()
    if (result.path) await scan.start(result.path)
  }

  // Mix Plans has its own full chain workspace; showing the compact dock there too
  // would render the same plan twice. Hide it on that page only.
  const showChainDock = !!activePlanId && page !== 'mix-plans' && page !== 'recordings'
  // Hide the bottom MiniPlayer (visually) whenever the Library workspace is in
  // front — the workspace already shows playback controls + waveform for the
  // loaded track, so two strips would just duplicate.
  //
  // Important: we only HIDE it, never unmount. The MiniPlayer owns the App-level
  // audio deck (HTMLAudioElement + Web Audio graph + the imperative play/pause/seek
  // commands published into usePlayer). Unmounting it kills the deck, which is
  // why playback fired off the workspace was silent until the user navigated to
  // a page where MiniPlayer remounted.
  const showMiniPlayer = !libraryWorkspaceActive && page !== 'recordings'

  return (
    <div className="flex h-full"
      onDragOver={(e) => {
        // Child WISP drop targets handle their own payloads first. Reject stray
        // native files/URLs. Unified row drags also carry WISP IDs, so playlist
        // and mix handlers accept them before this fallback rejects anything.
        if (!e.defaultPrevented && e.dataTransfer.types.some((type) =>
          type === 'Files' || type === 'text/uri-list' || type === 'DownloadURL')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'none'
        }
      }}
      // Never let an unhandled drop navigate the embedded browser or download.
      // Bubbling preserves playlist/mix handlers; no files are imported here.
      onDrop={(e) => e.preventDefault()}>
      <AppSidebar />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppHeader
          scanActive={scan.active}
          onScan={pickAndScan}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <RecordingInputIndicator />
        <MixRecordingIndicator />
        <main className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<div className="p-6 text-sm text-[var(--color-muted)]">Loading workspaceâ€¦</div>}>
          {page === 'library' && <LibraryPage />}
          {page === 'mix-plans' && <MixPlansPage />}
          {page === 'discover' && <DiscoverPage />}
          {page === 'wanted' && <WantedPage />}
          {page === 'crate-digger' && <CrateDiggerPage />}
          {page === 'recordings' && <RecordingsWorkspace />}
          </Suspense>
        </main>

        {showChainDock && (
          <ChainDock
            planId={activePlanId!}
            collapsed={chainCollapsed}
            onToggle={() => setChainCollapsed((c) => !c)}
          />
        )}

        <div className={showMiniPlayer ? '' : 'hidden'}>
          <MiniPlayer />
        </div>
      </div>

      {/* Global toasts + overlays — not page-scoped */}
      <ScanToast
        progress={scan.progress}
        error={scan.error}
        active={scan.active}
        onDismiss={scan.dismiss}
      />
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      <DialogHost />
    </div>
  )
}

export default App
