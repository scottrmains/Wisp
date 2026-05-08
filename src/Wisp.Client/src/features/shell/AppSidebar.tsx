import { useCurrentPage, type AppPage } from '../../state/currentPage'
import { useUiPrefs } from '../../state/uiPrefs'

interface SectionDef {
  id: AppPage
  label: string
  icon: string
}

const SECTIONS: SectionDef[] = [
  { id: 'library', label: 'Library', icon: '🎵' },
  { id: 'mix-plans', label: 'Mix Plans', icon: '🎚' },
  { id: 'rediscover', label: 'Rediscover', icon: '🔁' },
  { id: 'crate-digger', label: 'Crate Digger', icon: '⛏' },
]

/// Left-rail navigation. Owns the cross-page section switcher (replaces the
/// old top-nav buttons in `AppHeader`). Collapses to an icons-only rail via
/// the chevron at the top; preference persisted via `useUiPrefs`.
///
/// This is intentionally lightweight for v1 — Phase 21b will add a Playlists
/// section here once playlists exist; counts (Active / Archived / Wanted)
/// land alongside that.
export function AppSidebar() {
  const page = useCurrentPage((s) => s.page)
  const setPage = useCurrentPage((s) => s.setPage)
  const collapsed = useUiPrefs((s) => s.sidebarCollapsed)
  const toggle = useUiPrefs((s) => s.toggleSidebarCollapsed)

  return (
    <aside
      className={[
        'flex shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-[width]',
        collapsed ? 'w-12' : 'w-56',
      ].join(' ')}
    >
      <div className="flex h-12 items-center justify-between border-b border-[var(--color-border)] px-3">
        {!collapsed && (
          <span className="text-sm font-semibold tracking-tight">Wisp</span>
        )}
        <button
          onClick={toggle}
          className="ml-auto text-[var(--color-muted)] hover:text-white"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {SECTIONS.map((s) => (
          <SidebarButton
            key={s.id}
            active={page === s.id}
            collapsed={collapsed}
            icon={s.icon}
            label={s.label}
            onClick={() => setPage(s.id)}
          />
        ))}
      </nav>
    </aside>
  )
}

function SidebarButton({
  active,
  collapsed,
  icon,
  label,
  onClick,
}: {
  active: boolean
  collapsed: boolean
  icon: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={[
        'flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors',
        collapsed ? 'justify-center' : '',
        active
          ? 'bg-[var(--color-accent)]/20 text-white'
          : 'text-[var(--color-muted)] hover:bg-white/5 hover:text-white',
      ].join(' ')}
    >
      <span aria-hidden className="text-base">{icon}</span>
      {!collapsed && <span>{label}</span>}
    </button>
  )
}
