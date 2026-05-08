import { bridge, bridgeAvailable } from '../../bridge'
import { PlanSwitcher } from '../mixchain/PlanSwitcher'
import { SoulseekStatusIndicator } from '../soulseek/SoulseekStatusIndicator'

interface Props {
  scanActive: boolean
  onScan: () => void
  onOpenSettings: () => void
}

/// Slim top bar — section navigation moved to `AppSidebar`. This bar now only
/// owns global actions (Plan switcher, Soulseek transfer indicator, Scan, Settings).
/// Kept around as its own component partly for the global-search slot we'll add later.
export function AppHeader({ scanActive, onScan, onOpenSettings }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-end gap-3 border-b border-[var(--color-border)] px-4">
      <SoulseekStatusIndicator />
      <PlanSwitcher />
      <span className="h-6 w-px bg-[var(--color-border)]" aria-hidden />
      <button
        onClick={onScan}
        disabled={!bridgeAvailable() || scanActive}
        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        title={bridgeAvailable() ? 'Pick a folder and scan' : 'Folder picker only works inside Photino'}
      >
        {scanActive ? 'Scanning…' : 'Scan folder'}
      </button>
      <button
        onClick={onOpenSettings}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-muted)] hover:text-white"
        aria-label="Settings"
        title="Settings"
      >
        ⚙
      </button>
    </header>
  )
}

// Re-export bridge for any caller that still needs it externally.
export { bridge }
