import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AudioLines,
  Compass,
  Heart,
  Library as LibraryIcon,
  ListMusic,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pickaxe,
  Plus,
  Search,
  Settings2,
  Trash2,
  MoreHorizontal,
  X,
  type LucideIcon,
} from 'lucide-react'
import { playlists } from '../../api/playlists'
import { useActivePlaylist } from '../../state/activePlaylist'
import { useCurrentPage, type AppPage } from '../../state/currentPage'
import { useUiPrefs } from '../../state/uiPrefs'
import { alertDialog, confirmDialog, promptDialog } from '../../components/dialog'
import { addTracksToPlaylist } from '../library/addTracksToPlaylist'
import { WispLogo } from '../../components/WispLogo'
import { CreatePlaylistDialog } from '../library/CreatePlaylistDialog'
import { useWantedTracks } from '../wanted/useWantedTracks'
import { apiGet } from '../../api/client'
import { Button, IconButton } from '../../components/ui/Button'
import { Drawer } from '../../components/ui/Modal'
import { ActionMenu } from '../../components/ui/ActionMenu'
import { StatusMessage } from '../../components/ui/StatusMessage'

const WORKSPACE: { id: AppPage; label: string; icon: LucideIcon }[] = [
  { id: 'library', label: 'Library', icon: LibraryIcon },
  { id: 'mix-plans', label: 'Mix Plans', icon: ListMusic },
  { id: 'recordings', label: 'Mixes', icon: AudioLines },
]
const FIND_MUSIC: typeof WORKSPACE = [
  { id: 'discover', label: 'Discover', icon: Compass },
  { id: 'crate-digger', label: 'Crate Digger', icon: Pickaxe },
  { id: 'wanted', label: 'Wanted', icon: Heart },
]
const WISP_DRAG_TYPE = 'application/x-wisp-track-ids'

export function AppSidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const page = useCurrentPage((s) => s.page)
  const setPage = useCurrentPage((s) => s.setPage)
  const savedCollapsed = useUiPrefs((s) => s.sidebarCollapsed)
  const compactExpanded = useUiPrefs((s) => s.sidebarCompactExpanded)
  const setCompactExpanded = useUiPrefs((s) => s.setSidebarCompactExpanded)
  const toggle = useUiPrefs((s) => s.toggleSidebarCollapsed)
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1100px)').matches)
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)')
    const changed = () => setNarrow(media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  const collapsed = narrow ? !compactExpanded : savedCollapsed
  const activePlaylistId = useActivePlaylist((s) => s.activePlaylistId)
  const setActivePlaylistId = useActivePlaylist((s) => s.setActivePlaylistId)
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const playlistList = useQuery({
    queryKey: ['playlists'],
    queryFn: () => playlists.list(),
    staleTime: 30_000,
  })
  const wantedCount = useWantedTracks().items.length
  const soulseek = useQuery({
    queryKey: ['soulseek-status'],
    queryFn: () =>
      apiGet<{ isConfigured: boolean; hasUsername?: boolean; hasPassword?: boolean }>(
        '/api/settings/soulseek',
      ),
    staleTime: 60_000,
  })
  const soulseekSetUp =
    soulseek.data?.isConfigured || (soulseek.data?.hasUsername && soulseek.data?.hasPassword)
  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => playlists.update(id, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => playlists.delete(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['playlists'] })
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
    try {
      await rename.mutateAsync({ id, name })
    } catch (error) {
      await alertDialog({
        title: 'Could not rename playlist',
        message: (error as Error).message,
        tone: 'error',
      })
    }
  }
  const handleDelete = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: `Delete playlist "${name}"?`,
      message: 'The playlist is removed. The tracks themselves stay in your library.',
      danger: true,
    })
    if (!ok) return
    try {
      await remove.mutateAsync(id)
    } catch (error) {
      await alertDialog({
        title: 'Could not delete playlist',
        message: (error as Error).message,
        tone: 'error',
      })
    }
  }
  const filtered = (playlistList.data ?? []).filter((p) =>
    p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  )
  const playlistRows = (
    <>
      {playlistList.isLoading && (
        <p role="status" className="p-2 text-xs text-[var(--color-muted)]">
          Loading playlists…
        </p>
      )}
      {playlistList.isError && (
        <>
          <StatusMessage tone="error">Could not load playlists.</StatusMessage>
          <Button small onClick={() => void playlistList.refetch()}>
            Retry playlists
          </Button>
        </>
      )}
      {playlistList.isSuccess && !playlistList.data.length && (
        <p className="p-2 text-xs text-[var(--color-muted)]">
          No playlists yet. Create one, then add or drag tracks into it.
        </p>
      )}
      {!!playlistList.data?.length && !filtered.length && (
        <p className="p-2 text-xs text-[var(--color-muted)]">
          No matching playlists. Try another name.
        </p>
      )}
      <ul aria-label="Saved playlists">
        {filtered.map((p) => (
          <PlaylistRow
            key={p.id}
            id={p.id}
            name={p.name}
            trackCount={p.trackCount}
            active={page === 'library' && activePlaylistId === p.id}
            onClick={() => {
              setActivePlaylistId(p.id)
              setPage('library')
              setDrawerOpen(false)
            }}
            onRename={() => void handleRename(p.id, p.name)}
            onDelete={() => void handleDelete(p.id, p.name)}
          />
        ))}
      </ul>
    </>
  )
  const newPlaylist = () => {
    setDrawerOpen(false)
    setCreateOpen(true)
  }
  return (
    <aside
      aria-label="WISP sidebar"
      className={`app-sidebar${collapsed ? ' app-sidebar--compact' : ''}`}
    >
      <div className="app-brand">
        {!collapsed && (
          <>
            <WispLogo size={30} />
            <strong>WISP</strong>
          </>
        )}
        <IconButton
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          variant="quiet"
          onClick={() => (narrow ? setCompactExpanded(!compactExpanded) : toggle())}
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </IconButton>
      </div>
      <nav className="app-nav" aria-label="Main navigation">
        <h2 className="app-nav-group">Workspace</h2>
        {WORKSPACE.map((s) => (
          <SidebarButton
            key={s.id}
            {...s}
            collapsed={collapsed}
            active={page === s.id && (s.id !== 'library' || activePlaylistId === null)}
            onClick={() => {
              if (s.id === 'library') setActivePlaylistId(null)
              setPage(s.id)
            }}
          />
        ))}
        <h2 className="app-nav-group">Find music</h2>
        {FIND_MUSIC.map((s) => (
          <SidebarButton
            key={s.id}
            {...s}
            collapsed={collapsed}
            active={page === s.id}
            badge={s.id === 'wanted' && wantedCount > 0 ? wantedCount : undefined}
            onClick={() => setPage(s.id)}
          />
        ))}
        {soulseekSetUp && (
          <SidebarButton
            label="Soulseek"
            icon={Network}
            collapsed={collapsed}
            active={page === 'soulseek'}
            onClick={() => setPage('soulseek')}
          />
        )}
      </nav>
      {collapsed ? (
        <div className="px-3 py-2">
          <IconButton
            label="Open playlists"
            variant="quiet"
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
          >
            <ListMusic />
          </IconButton>
        </div>
      ) : (
        <section className="app-playlists" aria-label="Playlists">
          <header className="app-playlist-heading">
            <h2>Playlists</h2>
            <div>
              <IconButton
                label="Search playlists"
                variant="quiet"
                aria-expanded={searchOpen}
                onClick={() => {
                  if (searchOpen) {
                    setQuery('')
                    setSearchOpen(false)
                  } else {
                    setSearchOpen(true)
                    requestAnimationFrame(() => searchRef.current?.focus())
                  }
                }}
              >
                <Search />
              </IconButton>
              <IconButton label="New playlist" variant="quiet" onClick={newPlaylist}>
                <Plus />
              </IconButton>
            </div>
          </header>
          {searchOpen && (
            <input
              ref={searchRef}
              type="search"
              aria-label="Search playlists"
              placeholder="Find a playlist"
              className="app-playlist-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="app-playlist-scroll">{playlistRows}</div>
        </section>
      )}
      <footer className="app-sidebar-footer">
        <SidebarButton
          label="Settings"
          icon={Settings2}
          collapsed={collapsed}
          active={false}
          onClick={onOpenSettings}
        />
        {!collapsed && <p>LOCAL FIRST. MUSIC FIRST.</p>}
      </footer>
      {drawerOpen && (
        <Drawer
          labelledBy="playlist-drawer-title"
          className="app-playlist-drawer"
          onClose={() => setDrawerOpen(false)}
        >
          <header className="app-playlist-heading">
            <h2 id="playlist-drawer-title">Playlists</h2>
            <IconButton
              label="Close playlists"
              variant="quiet"
              onClick={() => setDrawerOpen(false)}
            >
              <X />
            </IconButton>
          </header>
          <input
            type="search"
            aria-label="Find playlist in drawer"
            placeholder="Find a playlist"
            className="app-playlist-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="app-playlist-scroll">{playlistRows}</div>
          <Button onClick={newPlaylist}>
            <Plus size={18} />
            New playlist
          </Button>
        </Drawer>
      )}
      {createOpen && (
        <CreatePlaylistDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setQuery('')
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
  icon: Icon,
  label,
  badge,
  onClick,
}: {
  active: boolean
  collapsed: boolean
  icon: LucideIcon
  label: string
  badge?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-ui-tooltip={collapsed ? `${label}${badge ? ` (${badge})` : ''}` : undefined}
      className="app-nav-button"
    >
      <Icon aria-hidden="true" />
      {!collapsed && (
        <>
          <span className="app-nav-label">{label}</span>
          {badge !== undefined && <span className="app-nav-count">{badge}</span>}
        </>
      )}
    </button>
  )
}

/** Preserve the custom WISP-ID drop workflow and shared duplicate prompt.
 * Native files/URLs alone never import or download anything here.
 */
function PlaylistRow({
  id,
  name,
  trackCount,
  active,
  onClick,
  onRename,
  onDelete,
}: {
  id: string
  name: string
  trackCount: number
  active: boolean
  onClick: () => void
  onRename: () => void
  onDelete: () => void
}) {
  const qc = useQueryClient()
  const menuTrigger = useRef<HTMLButtonElement>(null)
  const [isDropTarget, setIsDropTarget] = useState(false)
  const [recentlyAdded, setRecentlyAdded] = useState<number | null>(null)
  const dropBusy = useRef(false)
  const [dropPending, setDropPending] = useState(false)
  useEffect(() => {
    if (recentlyAdded === null) return
    const timer = setTimeout(() => setRecentlyAdded(null), 2500)
    return () => clearTimeout(timer)
  }, [recentlyAdded])
  const isWispDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(WISP_DRAG_TYPE)
  const onDrop = async (e: React.DragEvent) => {
    if (!isWispDrag(e)) return
    e.preventDefault()
    setIsDropTarget(false)
    if (dropBusy.current) return
    dropBusy.current = true
    setDropPending(true)
    try {
      const ids: unknown = JSON.parse(e.dataTransfer.getData(WISP_DRAG_TYPE))
      if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string'))
        throw new Error('Invalid track selection. Select the tracks again.')
      const res = await addTracksToPlaylist(id, ids)
      if (!res) return
      setRecentlyAdded((prev) => (prev ?? 0) + res.added)
      qc.invalidateQueries({ queryKey: ['playlists'] })
      qc.invalidateQueries({ queryKey: ['tracks'] })
    } catch (error) {
      await alertDialog({
        title: 'Could not add to playlist',
        message: (error as Error).message,
        tone: 'error',
      })
    } finally {
      dropBusy.current = false
      setDropPending(false)
    }
  }
  return (
    <li
      className={`app-playlist-row${isDropTarget ? ' app-playlist-row--drop' : ''}`}
      onDragOver={(e) => {
        if (!isWispDrag(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setIsDropTarget(true)
      }}
      onDragLeave={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget))
          setIsDropTarget(false)
      }}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="app-playlist-button"
        onClick={onClick}
        disabled={dropPending}
        aria-busy={dropPending}
        aria-current={active ? 'page' : undefined}
        aria-label={`${name}, ${trackCount} tracks`}
        data-ui-tooltip={`${name} · ${trackCount} tracks. Open playlist or drop selected WISP tracks here.`}
        onContextMenu={(e) => {
          e.preventDefault()
          menuTrigger.current?.click()
        }}
      >
        <span className="truncate">{name}</span>
        <span className="flex shrink-0 items-center gap-1">
          {!!recentlyAdded && (
            <span role="status" className="text-[var(--ui-success)]">
              +{recentlyAdded}
            </span>
          )}
          <span className="app-nav-count">{trackCount}</span>
        </span>
      </button>
      <ActionMenu
        triggerRef={menuTrigger}
        label={`Actions for ${name}`}
        icon={<MoreHorizontal size={18} />}
        items={[
          { label: 'Rename playlist', icon: <Pencil size={16} />, onSelect: onRename },
          {
            label: 'Delete playlist',
            icon: <Trash2 size={16} />,
            danger: true,
            onSelect: onDelete,
          },
        ]}
      />
    </li>
  )
}
