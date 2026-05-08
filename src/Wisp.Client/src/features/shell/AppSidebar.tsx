import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { playlists } from '../../api/playlists'
import { useActivePlaylist } from '../../state/activePlaylist'
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

/// Left-rail navigation. Owns the cross-page section switcher AND (since 21b) the
/// Playlists tree. Clicking a playlist scopes the Library view to it via
/// `useActivePlaylist`. Right-click a playlist to rename / delete.
export function AppSidebar() {
  const page = useCurrentPage((s) => s.page)
  const setPage = useCurrentPage((s) => s.setPage)
  const collapsed = useUiPrefs((s) => s.sidebarCollapsed)
  const toggle = useUiPrefs((s) => s.toggleSidebarCollapsed)
  const activePlaylistId = useActivePlaylist((s) => s.activePlaylistId)
  const setActivePlaylistId = useActivePlaylist((s) => s.setActivePlaylistId)
  const qc = useQueryClient()
  const [contextMenu, setContextMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null)

  const playlistList = useQuery({
    queryKey: ['playlists'],
    queryFn: () => playlists.list(),
    staleTime: 30_000,
  })

  const create = useMutation({
    mutationFn: (name: string) => playlists.create(name),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['playlists'] })
      // Auto-select the new playlist + jump to library so the user can start adding to it.
      setActivePlaylistId(created.id)
      setPage('library')
    },
  })

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => playlists.update(id, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => playlists.delete(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['playlists'] })
      // If the deleted playlist was scoping the library, drop the scope.
      if (activePlaylistId === id) setActivePlaylistId(null)
    },
  })

  const handleCreate = () => {
    const name = window.prompt('Playlist name')
    if (!name?.trim()) return
    create.mutate(name.trim())
  }

  const handleRename = (id: string, currentName: string) => {
    const name = window.prompt('Rename playlist', currentName)
    if (!name?.trim() || name.trim() === currentName) return
    rename.mutate({ id, name: name.trim() })
  }

  const handleDelete = (id: string, name: string) => {
    if (!window.confirm(`Delete playlist "${name}"?\n\nTracks themselves stay in your library.`)) return
    remove.mutate(id)
  }

  const onPlaylistClick = (id: string) => {
    setActivePlaylistId(id)
    setPage('library')
  }

  return (
    <aside
      className={[
        'flex shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-[width]',
        collapsed ? 'w-12' : 'w-56',
      ].join(' ')}
    >
      <div className="flex h-12 items-center justify-between border-b border-[var(--color-border)] px-3">
        {!collapsed && <span className="text-sm font-semibold tracking-tight">Wisp</span>}
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
            active={page === s.id && (s.id !== 'library' || activePlaylistId === null)}
            collapsed={collapsed}
            icon={s.icon}
            label={s.label}
            onClick={() => {
              // Clicking a section button always clears the playlist scope so the section
              // shows its full content. Otherwise switching from a scoped Library to
              // Mix Plans and back would silently keep the scope.
              if (s.id === 'library') setActivePlaylistId(null)
              setPage(s.id)
            }}
          />
        ))}

        {/* Playlists section — only shown when the sidebar is expanded.
            Collapsed sidebar would crowd; users can still create/manage from the
            expanded view and the scope stays applied even after collapsing. */}
        {!collapsed && (
          <>
            <div className="mt-3 flex items-center justify-between px-2 pt-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              <span>Playlists</span>
              <button
                onClick={handleCreate}
                className="text-base leading-none text-[var(--color-muted)] hover:text-white"
                title="New playlist"
                aria-label="New playlist"
              >
                +
              </button>
            </div>
            <ul className="flex flex-col gap-0.5 px-1 pt-1">
              {playlistList.isLoading && (
                <li className="px-2 py-1 text-[11px] text-[var(--color-muted)]">Loading…</li>
              )}
              {playlistList.data && playlistList.data.length === 0 && (
                <li className="px-2 py-1 text-[11px] text-[var(--color-muted)]">
                  No playlists yet — click + to create one.
                </li>
              )}
              {(playlistList.data ?? []).map((p) => {
                const active = page === 'library' && activePlaylistId === p.id
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => onPlaylistClick(p.id)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setContextMenu({ id: p.id, name: p.name, x: e.clientX, y: e.clientY })
                      }}
                      className={[
                        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors',
                        active
                          ? 'bg-[var(--color-accent)]/20 text-white'
                          : 'text-[var(--color-muted)] hover:bg-white/5 hover:text-white',
                      ].join(' ')}
                      title={`Scope library to "${p.name}"`}
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-muted)]">
                        {p.trackCount}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </nav>

      {/* Tiny inline "right-click menu" — purposely minimal (rename / delete only)
          to avoid pulling in the heavier RowContextMenu pattern for two actions. */}
      {contextMenu && (
        <PlaylistContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onRename={() => {
            handleRename(contextMenu.id, contextMenu.name)
            setContextMenu(null)
          }}
          onDelete={() => {
            handleDelete(contextMenu.id, contextMenu.name)
            setContextMenu(null)
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
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

function PlaylistContextMenu({
  x,
  y,
  onRename,
  onDelete,
  onClose,
}: {
  x: number
  y: number
  onRename: () => void
  onDelete: () => void
  onClose: () => void
}) {
  // Click-outside dismiss. Using window mousedown with capture so we beat any
  // child handler.
  return (
    <>
      <div className="fixed inset-0 z-50" onMouseDown={onClose} />
      <div
        className="fixed z-50 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] py-1 text-sm shadow-2xl"
        style={{ left: x, top: y, width: 160 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button onClick={onRename} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-accent)]/20 hover:text-white">
          <span className="w-4 text-center text-[var(--color-muted)]">✎</span>
          <span>Rename</span>
        </button>
        <button onClick={onDelete} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-300 hover:bg-red-500/10">
          <span className="w-4 text-center">🗑</span>
          <span>Delete</span>
        </button>
      </div>
    </>
  )
}
