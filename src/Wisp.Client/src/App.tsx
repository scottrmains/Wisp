import { useState } from 'react'
import { useActivePlan } from './state/activePlan'
import { useCurrentPage } from './state/currentPage'
import { CrateDiggerPage } from './features/cratedigger/CrateDiggerPage'
import { LibraryPage } from './features/library/LibraryPage'
import { ScanToast } from './features/library/ScanToast'
import { useScan } from './features/library/useScan'
import { ChainDock } from './features/mixchain/ChainDock'
import { MixPlansPage } from './features/mixchain/MixPlansPage'
import { MiniPlayer } from './features/player/MiniPlayer'
import { RediscoverScreen } from './features/rediscover/RediscoverScreen'
import { SettingsPanel } from './features/settings/SettingsPanel'
import { AppHeader } from './features/shell/AppHeader'
import { AppSidebar } from './features/shell/AppSidebar'
import { bridge, bridgeAvailable } from './bridge'

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
  const showChainDock = !!activePlanId && page !== 'mix-plans'

  return (
    <div className="flex h-full">
      <AppSidebar />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AppHeader
          scanActive={scan.active}
          onScan={pickAndScan}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <main className="min-h-0 flex-1 overflow-hidden">
          {page === 'library' && <LibraryPage />}
          {page === 'mix-plans' && <MixPlansPage />}
          {page === 'rediscover' && <RediscoverScreen />}
          {page === 'crate-digger' && <CrateDiggerPage />}
        </main>

        {showChainDock && (
          <ChainDock
            planId={activePlanId!}
            collapsed={chainCollapsed}
            onToggle={() => setChainCollapsed((c) => !c)}
          />
        )}

        <MiniPlayer />
      </div>

      {/* Global toasts + overlays — not page-scoped */}
      <ScanToast
        progress={scan.progress}
        error={scan.error}
        active={scan.active}
        onDismiss={scan.dismiss}
      />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
