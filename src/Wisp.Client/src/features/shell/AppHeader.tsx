import { bridge, bridgeAvailable } from '../../bridge'
import { useCurrentPage, type AppPage } from '../../state/currentPage'
import { PlanSwitcher } from '../mixchain/PlanSwitcher'
import { SoulseekStatusIndicator } from '../soulseek/SoulseekStatusIndicator'

interface Props {
  scanActive: boolean
  onScan: () => void
  onOpenSettings: () => void
}

const SECTIONS: { id: AppPage; label: string }[] = [
  { id: 'library', label: 'Library' },
  { id: 'mix-plans', label: 'Mix Plans' },
  { id: 'rediscover', label: 'Rediscover' },
  { id: 'crate-digger', label: 'Crate Digger' },
]

/// Top-of-window chrome, always visible regardless of the active page.
/// Sections on the left switch the routed content; actions on the right are
/// global (Plan switcher / Scan / Settings) and don't change page.
export function AppHeader({ scanActive, onScan, onOpenSettings }: Props) {
  const page = useCurrentPage((s) => s.page)
  const setPage = useCurrentPage((s) => s.setPage)

  return (
    <header className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
      <div className="flex items-center gap-6">
        <h1 className="text-base font-semibold tracking-tight">Wisp</h1>
        <nav className="flex items-center gap-1 text-sm">
          {SECTIONS.map((s) => (
            <NavButton
              key={s.id}
              active={page === s.id}
              onClick={() => setPage(s.id)}
            >
              {s.label}
            </NavButton>
          ))}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {/* Soulseek transfer status — only renders when there are active transfers (or
            recently-completed ones), so the bar stays clean when nothing's happening. */}
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
      </div>
    </header>
  )
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-md px-3 py-1.5 transition-colors',
        active
          ? 'bg-[var(--color-accent)]/20 text-white'
          : 'text-[var(--color-muted)] hover:bg-white/5 hover:text-white',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// Re-export for any caller that still needs to invoke pickFolder externally.
export { bridge }
