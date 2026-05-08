import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { playlists } from '../../api/playlists'
import { useActivePlaylist } from '../../state/activePlaylist'
import { useCurrentPage, type AppPage } from '../../state/currentPage'
import { useUiPrefs } from '../../state/uiPrefs'
import { confirmDialog, promptDialog } from '../../components/dialog'
import { CreatePlaylistDialog } from '../library/CreatePlaylistDialog'
import { useWantedTracks } from '../wanted/useWantedTracks'

interface SectionDef {
  id: AppPage
  label: string
  icon: string
}

const SECTIONS: SectionDef[] = [
  { id: 'library', label: 'Library', icon: '🎵' },
  { id: 'mix-plans', label: 'Mix Plans', icon: '🎚' },
  { id: 'discover', label: 'Discover', icon: '🔁' },
  { id: 'wanted', label: 'Wanted', icon: '❤️' },
  { id: 'crate-digger', label: 'Crate Digger', icon: '⛏' },
]

const WISP_DRAG_TYPE = 'application/x-wisp-track-ids'

/// Left-rail navigation. Owns the cross-page section switcher AND (since 21b) the
/// Playlists tree. Clicking a playlist scopes the Library view to it via
/// `useActivePlaylist`. Right-click a playlist to rename / delete.
///
/// Drag-and-drop (this commit): library rows can be dragged onto a playlist
/// entry to bulk-add via the existing /tracks/bulk endpoint.
export function AppSidebar() {
  const page = useCurrentPage((s) => s.page)
  const setPage = useCurrentPage((s) => s.setPage)
  const collapsed = useUiPrefs((s) => s.sidebarCollapsed)
  const toggle = useUiPrefs((s) => s.toggleSidebarCollapsed)
  const activePlaylistId = useActivePlaylist((s) => s.activePlaylistId)
  const setActivePlaylistId = useActivePlaylist((s) => s.setActivePlaylistId)
  const qc = useQueryClient()
  const [contextMenu, setContextMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const playlistList = useQuery({
    queryKey: ['playlists'],
    queryFn: () => playlists.list(),
    staleTime: 30_000,
  })
  // Count badge for the Wanted entry — reads the same TanStack cache the
  // Wanted page uses, so a Want from Discover bumps the badge in real time.
  const wantedTracks = useWantedTracks()
  const wantedCount = wantedTracks.items.length

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

  const handleRename = async (id: string, currentName: string) => {
    const name = await promptDialog({
      title: 'Rename playlist',
      defaultValue: currentName,
      placeholder: 'Playlist name',
      confirmLabel: 'Rename',
    })
    if (!name || name === currentName) return
    rename.mutate({ id, name })
  }

  const handleDelete = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: `Delete playlist "${name}"?`,
      message: 'The playlist is removed. The tracks themselves stay in your library.',
      danger: true,
    })
    if (!ok) return
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
            badge={s.id === 'wanted' && wantedCount > 0 ? wantedCount : undefined}
            onClick={() => {
              if (s.id === 'library') setActivePlaylistId(null)
              setPage(s.id)
            }}
          />
        ))}

        {!collapsed && (
          <>
            <div className="mt-3 flex items-center justify-between px-2 pt-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              <span>Playlists</span>
              <button
                onClick={() => setCreateOpen(true)}
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
                  No playlists yet — click + or drag tracks here.
                </li>
              )}
              {(playlistList.data ?? []).map((p) => (
                <PlaylistRow
                  key={p.id}
                  id={p.id}
                  name={p.name}
                  trackCount={p.trackCount}
                  active={page === 'library' && activePlaylistId === p.id}
                  onClick={() => onPlaylistClick(p.id)}
                  onContextMenu={(x, y) => setContextMenu({ id: p.id, name: p.name, x, y })}
                />
              ))}
            </ul>
          </>
        )}
      </nav>

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

      {createOpen && (
        <CreatePlaylistDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            // Auto-select the new playlist + jump to library so the user can start
            // adding to it (or drag tracks straight onto it).
            setActivePlaylistId(created.id)
            setPage('library')
          }}
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
  badge,
  onClick,
}: {
  active: boolean
  collapsed: boolean
  icon: string
  label: string
  /// Optional count badge after the label (e.g. Wanted: N). Only renders
  /// when expanded; in collapsed mode the count would have nowhere to go.
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? `${label}${badge ? ` (${badge})` : ''}` : undefined}
      className={[
        'flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors',
        collapsed ? 'justify-center' : '',
        active
          ? 'bg-[var(--color-accent)]/20 text-white'
          : 'text-[var(--color-muted)] hover:bg-white/5 hover:text-white',
      ].join(' ')}
    >
      <span aria-hidden className="text-base">{icon}</span>
      {!collapsed && (
        <>
          <span className="flex-1 text-left">{label}</span>
          {badge !== undefined && (
            <span className="rounded-full bg-[var(--color-accent)]/30 px-1.5 text-[10px] font-medium tabular-nums text-white">
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  )
}

/// Single playlist entry. Drop target for `application/x-wisp-track-ids` payloads
/// from the library table — bulk-adds the dragged selection. Visual feedback while
/// dragging over (accent border) and a brief "+N" badge after a successful drop.
function PlaylistRow({
  id,
  name,
  trackCount,
  active,
  onClick,
  onContextMenu,
}: {
  id: string
  name: string
  trackCount: number
  active: boolean
  onClick: () => void
  onContextMenu: (x: number, y: number) => void
}) {
  const qc = useQueryClient()
  const [isDropTarget, setIsDropTarget] = useState(false)
  const [recentlyAdded, setRecentlyAdded] = useState<number | null>(null)

  // Auto-clear the "+N" indicator after 2.5s.
  useEffect(() => {
    if (recentlyAdded === null) return
    const t = setTimeout(() => setRecentlyAdded(null), 2_500)
    return () => clearTimeout(t)
  }, [recentlyAdded])

  const isWispDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(WISP_DRAG_TYPE)

  const onDragOver = (e: React.DragEvent) => {
    if (!isWispDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!isDropTarget) setIsDropTarget(true)
  }
  const onDragLeave = (e: React.DragEvent) => {
    // Only clear when leaving the row entirely — child traversals fire dragleave too.
    if (e.currentTarget === e.target) setIsDropTarget(false)
  }
  const onDrop = async (e: React.DragEvent) => {
    if (!isWispDrag(e)) return
    e.preventDefault()
    setIsDropTarget(false)
    try {
      const ids = JSON.parse(e.dataTransfer.getData(WISP_DRAG_TYPE)) as string[]
      const res = await playlists.addTracksBulk(id, ids)
      // Bump the recently-added count for the indicator. If the user drops twice in
      // quick succession, accumulate so they see the running total instead of a flicker.
      setRecentlyAdded((prev) => (prev ?? 0) + res.added)
      qc.invalidateQueries({ queryKey: ['playlists'] })
      qc.invalidateQueries({ queryKey: ['tracks'] })
    } catch (err) {
      console.error('Drop on playlist failed', err)
    }
  }

  return (
    <li>
      <button
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault()
          onContextMenu(e.clientX, e.clientY)
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={[
          'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs transition-colors',
          active
            ? 'bg-[var(--color-accent)]/20 text-white'
            : 'text-[var(--color-muted)] hover:bg-white/5 hover:text-white',
          isDropTarget ? 'ring-1 ring-inset ring-[var(--color-accent)]' : '',
        ].join(' ')}
        title={`Scope library to "${name}" — or drop tracks here to add them`}
      >
        <span className="truncate">{name}</span>
        <span className="flex shrink-0 items-center gap-1">
          {recentlyAdded !== null && recentlyAdded > 0 && (
            <span className="rounded bg-emerald-500/30 px-1 text-[9px] font-semibold text-emerald-200">
              +{recentlyAdded}
            </span>
          )}
          <span className="text-[10px] tabular-nums text-[var(--color-muted)]">{trackCount}</span>
        </span>
      </button>
    </li>
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
