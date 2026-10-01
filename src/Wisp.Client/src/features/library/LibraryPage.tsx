import { useEffect, useRef, useState, type SetStateAction } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tracks } from '../../api/library'
import { playlists as playlistsApi } from '../../api/playlists'
import type { Track, TrackQuery } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { useActivePlan } from '../../state/activePlan'
import { useActivePlaylist } from '../../state/activePlaylist'
import { useCurrentPage } from '../../state/currentPage'
import { usePlayer } from '../../state/player'
import type { InspectorTab } from '../../state/uiPrefs'
import { useUiPrefs } from '../../state/uiPrefs'
import { ArchiveModal } from '../archive/ArchiveModal'
import { CleanupModal } from '../cleanup/CleanupModal'
import { UndoToast } from '../cleanup/UndoToast'
import { useMixPlan } from '../mixchain/useMixPlans'
import { CdjExportButton } from '../usb/CdjExportButton'
import { AddToPlaylistDialog } from './AddToPlaylistDialog'
import { Button, IconButton } from '../../components/ui/Button'
import { ActionMenu } from '../../components/ui/ActionMenu'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { LibraryColumnsDialog } from './LibraryColumnsDialog'
import { BulkTagDialog } from './BulkTagDialog'
import { LibraryFilters } from './LibraryFilters'
import { LibraryTable } from './LibraryTable'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ExternalLink,
  ListMusic,
  Play,
  Plus,
  Sparkles,
  StickyNote,
  Tag as TagIcon,
  X,
  Columns3,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu'
import { TrackPrepWorkspace } from './TrackPrepWorkspace'
import { useScan } from './useScan'
import { useTrackFileDialog } from './TrackFileDialog'
import { ResizablePrepPane } from './ResizablePrepPane'
import { ExternalFileDrag } from './ExternalFileDrag'
import { useExternalFileDrag } from './useExternalFileDrag'
import { RemoveFromPlaylistDialog, type PlaylistRemoval } from './RemoveFromPlaylistDialog'
import { PlaylistDuplicatesDialog } from './PlaylistDuplicatesDialog'
import { LoudnessDialog } from './LoudnessDialog'
import { collectSelection, selectionScope, trackRowId, uniqueTrackIds } from './librarySelection'

const EMPTY_SELECTION = new Set<string>()

/// Library content for the routed App layout — no top-nav, no chain dock,
/// no mini-player. Those are App-level fixtures. This component owns the
/// library body: filters, selection toolbar, table, preparation, plus modals scoped
/// to library actions (cleanup, archive, bulk archive, bulk tag, context menu).
export function LibraryPage() {
  const [query, setQuery] = useState<TrackQuery>(() => ({
    page: 1,
    size: 500,
    sort: useUiPrefs.getState().librarySort,
  }))
  const changeQuery = (next: TrackQuery) => {
    setQuery(next)
    useUiPrefs.getState().setLibrarySort(next.sort ?? 'artist')
  }
  const [storedSelected, setSelected] = useState<Track | null>(null)
  const [selection, setSelection] = useState({
    scope: '',
    ids: new Set<string>(),
    rows: new Map<string, Track>(),
  })
  const selectionTracks = useRef(new Map<string, Track>())
  const selectionRequest = useRef<AbortController | null>(null)
  const [selectionStatus, setSelectionStatus] = useState({
    scope: '',
    pending: false,
    error: null as string | null,
  })
  const filtersVisible = useUiPrefs((s) => s.libraryFiltersVisible)
  const toggleFilters = useUiPrefs((s) => s.toggleLibraryFilters)
  const anchorIdRef = useRef<string | null>(null)
  const [focusTab, setFocusTab] = useState<InspectorTab | null>(null)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [cleanupTarget, setCleanupTarget] = useState<Track | null>(null)
  const [recentAudit, setRecentAudit] = useState<import('../../api/types').AuditEntry | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Track | null>(null)
  const [bulkArchiveIds, setBulkArchiveIds] = useState<string[] | null>(null)
  const [bulkTagIds, setBulkTagIds] = useState<string[] | null>(null)
  const [addToPlaylistIds, setAddToPlaylistIds] = useState<string[] | null>(null)
  const [contextMenu, setContextMenu] = useState<{ track: Track; x: number; y: number } | null>(
    null,
  )
  const [playlistRemoval, setPlaylistRemoval] = useState<PlaylistRemoval | null>(null)
  const [loudnessIds, setLoudnessIds] = useState<string[] | null>(null)
  const [duplicateScan, setDuplicateScan] = useState<{ id: string; name: string } | null>(null)
  const [playlistNotice, setPlaylistNotice] = useState<{ scope: string; message: string } | null>(
    null,
  )

  const qc = useQueryClient()
  const setPage = useCurrentPage((s) => s.setPage)
  const setLibraryWorkspaceActive = useCurrentPage((s) => s.setLibraryWorkspaceActive)
  const preparationOpen = useCurrentPage((s) => s.preparationOpen)
  const setPreparationOpen = useCurrentPage((s) => s.setPreparationOpen)
  const activePlaylistId = useActivePlaylist((s) => s.activePlaylistId)
  const setActivePlaylistId = useActivePlaylist((s) => s.setActivePlaylistId)
  // Playlist metadata for the header, already cached by the sidebar.
  const playlistList = useQuery({
    queryKey: ['playlists'],
    queryFn: () => playlistsApi.list(),
    staleTime: 30_000,
  })
  const activePlaylist = playlistList.data?.find((p) => p.id === activePlaylistId) ?? null
  const restore = useMutation({
    mutationFn: (id: string) => tracks.restore(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tracks'] }),
  })
  const onArchiveOrRestore = (t: Track) => {
    if (t.isArchived) restore.mutate(t.id)
    else setArchiveTarget(t)
  }
  const { activePlanId } = useActivePlan()
  const activePlan = useMixPlan(activePlanId)
  const scan = useScan()
  const playTrack = usePlayer((s) => s.playTrack)
  const togglePlay = usePlayer((s) => s.togglePlay)

  const addToActivePlan = (trackId: string) => {
    if (!activePlanId) return
    activePlan.addTrack.mutate({ trackId })
  }

  // Apply the active playlist scope to the query before sending. We don't bake
  // it into `query` state because the scope is owned by the sidebar (Zustand) —
  // the local `query` object should only carry library-page-owned filters.
  const effectiveQuery: TrackQuery = activePlaylistId
    ? { ...query, playlistId: activePlaylistId }
    : query

  const scopeKey = selectionScope(effectiveQuery)
  const fileDrag = useExternalFileDrag(scopeKey)
  const [previousScope, setPreviousScope] = useState(scopeKey)
  // Discard, rather than just hide, selection when switching scope. Otherwise
  // returning to an earlier playlist could revive a stale all-track selection.
  if (previousScope !== scopeKey) {
    setPreviousScope(scopeKey)
    setSelection({ scope: scopeKey, ids: new Set(), rows: new Map() })
    setSelected(null)
    setSelectionStatus({ scope: scopeKey, pending: false, error: null })
  }
  const selectingAll = selectionStatus.scope === scopeKey && selectionStatus.pending
  const selectionError = selectionStatus.scope === scopeKey ? selectionStatus.error : null
  const selectedIds = selection.scope === scopeKey ? selection.ids : EMPTY_SELECTION
  const selected = selection.scope === scopeKey ? storedSelected : null
  const setSelectedIds = (next: SetStateAction<Set<string>>) => {
    // Snapshot cached rows when an event changes selection; render from state,
    // not a mutable ref, so off-page entry/track identities stay in sync.
    const known = new Map(selectionTracks.current)
    setSelection((previous) => ({
      scope: scopeKey,
      rows: known,
      ids:
        typeof next === 'function'
          ? next(previous.scope === scopeKey ? previous.ids : EMPTY_SELECTION)
          : next,
    }))
  }

  useEffect(() => {
    // A filter/playlist change must cancel an in-flight all-pages selection.
    selectionRequest.current?.abort()
    selectionRequest.current = null
    selectionTracks.current.clear()
    anchorIdRef.current = null
    return () => {
      selectionRequest.current?.abort()
    }
  }, [scopeKey])

  const selectAll = async () => {
    if (selectionRequest.current) return
    const controller = new AbortController()
    selectionRequest.current = controller
    setSelectionStatus({ scope: scopeKey, pending: true, error: null })
    try {
      const all = await collectSelection(effectiveQuery, tracks.list, controller.signal)
      if (controller.signal.aborted) return
      selectionTracks.current = new Map(all.map((t) => [trackRowId(t), t]))
      setSelectedIds(new Set(all.map(trackRowId)))
      setSelected(all[0] ?? null)
    } catch (e) {
      if (!controller.signal.aborted)
        setSelectionStatus({ scope: scopeKey, pending: false, error: (e as Error).message })
    } finally {
      if (selectionRequest.current === controller) {
        selectionRequest.current = null
        setSelectionStatus((s) => ({ ...s, pending: false }))
      }
    }
  }

  const tracksQuery = useQuery({
    queryKey: ['tracks', effectiveQuery],
    queryFn: () => tracks.list(effectiveQuery),
  })
  const total = tracksQuery.data?.total ?? 0
  const items = tracksQuery.data?.items ?? []
  useEffect(() => {
    // Keep row payloads for manual Ctrl/Shift selections across page changes,
    // as well as for Select all, so internal WISP drags don't truncate either.
    for (const track of tracksQuery.data?.items ?? [])
      selectionTracks.current.set(trackRowId(track), track)
  }, [tracksQuery.data])

  // UI selection uses playlist-entry IDs; library/audio actions use track IDs.
  const pageRows = new Map(items.map((t) => [trackRowId(t), t]))
  const selectedRows = [...selectedIds]
    .map((id) => pageRows.get(id) ?? selection.rows.get(id))
    .filter((t): t is Track => !!t)
  const selectedTrackIds = uniqueTrackIds(selectedRows)
  const removeFromPlaylist = (rows: Track[]) => {
    if (!activePlaylistId) return
    const entryIds = rows.flatMap((t) => (t.playlistEntryId ? [t.playlistEntryId] : []))
    if (entryIds.length === 0) return
    setPlaylistRemoval({
      playlistId: activePlaylistId,
      playlistName: activePlaylist?.name ?? 'this playlist',
      entryIds,
    })
  }

  const hasActiveFilters = !!(
    query.search ||
    query.key ||
    query.bpmMin ||
    query.bpmMax ||
    query.energyMin ||
    query.energyMax ||
    query.missing ||
    query.addedWithinDays ||
    query.tag?.length ||
    query.archivedOnly ||
    query.includeArchived ||
    query.includeUnavailable
  )
  const showLibraryEmptyState =
    total === 0 && !tracksQuery.isLoading && !tracksQuery.isError && !hasActiveFilters

  const pickAndScan = async () => {
    if (!bridgeAvailable()) return
    const result = await bridge.pickFolder()
    if (result.path) await scan.start(result.path)
  }

  const onSelectRow = (t: Track, mods: { meta: boolean; shift: boolean }) => {
    selectionRequest.current?.abort()
    selectionTracks.current.set(trackRowId(t), t)
    setFocusTab(null)
    if (mods.meta) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(trackRowId(t))) next.delete(trackRowId(t))
        else next.add(trackRowId(t))
        return next
      })
      anchorIdRef.current = trackRowId(t)
      setSelected(t)
      return
    }
    if (mods.shift && anchorIdRef.current) {
      const ids = items.map(trackRowId)
      const aIdx = ids.indexOf(anchorIdRef.current)
      const bIdx = ids.indexOf(trackRowId(t))
      if (aIdx >= 0 && bIdx >= 0) {
        const [lo, hi] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx]
        setSelectedIds(new Set(ids.slice(lo, hi + 1)))
        setSelected(t)
        return
      }
    }
    setSelected(t)
    setSelectedIds(new Set([trackRowId(t)]))
    anchorIdRef.current = trackRowId(t)
  }
  const onActivateRow = (t: Track) => playTrack(t.id)
  const clearSelection = () => {
    selectionRequest.current?.abort()
    setSelected(null)
    setSelectedIds(new Set())
    anchorIdRef.current = null
  }

  const onDragStartRow = (t: Track): Track[] => {
    if (selectedIds.has(trackRowId(t)) && selectedIds.size > 1) {
      const known = new Map([
        ...selectionTracks.current,
        ...items.map((x) => [trackRowId(x), x] as const),
      ])
      return [...selectedIds].map((id) => known.get(id)).filter((x): x is Track => !!x)
    }
    setSelected(t)
    setSelectedIds(new Set([trackRowId(t)]))
    anchorIdRef.current = trackRowId(t)
    return [t]
  }

  // Workspace now drives off the player's loaded track, not the row selection.
  // Single-click selecting just highlights for context menu / bulk operations.
  const playerTrackId = usePlayer((s) => s.trackId)
  const loadTrack = (id: string) => {
    usePlayer.getState().loadTrack(id)
    useUiPrefs.getState().setInspectorCollapsed(false)
    setPreparationOpen(true)
  }
  const workspaceActive = playerTrackId !== null && preparationOpen
  const [prepMounted, setPrepMounted] = useState(false)
  if (workspaceActive && !prepMounted) setPrepMounted(true)

  // Tell App when the workspace is showing so it can suppress the redundant MiniPlayer.
  // Cleared on unmount so navigating away re-enables the mini-player on the next page.
  useEffect(() => {
    setLibraryWorkspaceActive(workspaceActive)
    return () => setLibraryWorkspaceActive(false)
  }, [workspaceActive, setLibraryWorkspaceActive])

  const buildMenuItems = (rowTrack: Track): ContextMenuItem[] => {
    const opIds =
      selectedIds.has(trackRowId(rowTrack)) && selectedIds.size > 1
        ? selectedTrackIds
        : [rowTrack.id]
    const isMulti = opIds.length > 1
    const hasPlan = !!activePlanId
    return [
      {
        id: 'play',
        icon: Play,
        label: 'Play',
        disabled: isMulti,
        disabledReason: 'Single track only',
        onSelect: () => playTrack(rowTrack.id),
      },
      {
        id: 'prepare',
        icon: SlidersHorizontal,
        label: 'Prepare track',
        disabled: isMulti,
        disabledReason: 'Select one track to prepare',
        onSelect: () => loadTrack(rowTrack.id),
      },
      {
        id: 'add',
        icon: Plus,
        label: isMulti ? `Add ${opIds.length} to mix` : 'Add to mix',
        disabled: !hasPlan,
        disabledReason: 'Pick or create an active mix plan first',
        onSelect: () => {
          for (const id of opIds) addToActivePlan(id)
        },
      },
      {
        id: 'find',
        icon: Sparkles,
        label: 'Find matches',
        disabled: isMulti,
        disabledReason: 'Single track only',
        onSelect: () => {
          // Load (without auto-play) so the workspace appears at the right tab.
          loadTrack(rowTrack.id)
          setFocusTab('recommendations')
          setTimeout(() => setFocusTab(null), 0)
        },
      },
      {
        id: 'tag',
        icon: TagIcon,
        label: isMulti ? `Tag ${opIds.length} tracks…` : 'Tag…',
        separator: true,
        onSelect: () => {
          if (isMulti) setBulkTagIds(opIds)
          else {
            loadTrack(rowTrack.id)
            setFocusTab('tags')
            setTimeout(() => setFocusTab(null), 0)
          }
        },
      },
      {
        id: 'playlist',
        icon: ListMusic,
        label: isMulti ? `Add ${opIds.length} to playlist…` : 'Add to playlist…',
        onSelect: () => setAddToPlaylistIds(opIds),
      },
      {
        id: 'loudness',
        icon: Sparkles,
        label: 'Loudness & audio versions…',
        onSelect: () => setLoudnessIds(opIds),
      },
      ...(activePlaylistId
        ? [
            {
              id: 'remove-from-playlist',
              icon: X,
              label: 'Remove from playlist…',
              onSelect: () =>
                removeFromPlaylist(
                  selectedIds.has(trackRowId(rowTrack)) ? selectedRows : [rowTrack],
                ),
            },
          ]
        : []),
      {
        id: 'notes',
        icon: StickyNote,
        label: 'Notes',
        disabled: isMulti,
        disabledReason: 'Single track only',
        onSelect: () => {
          loadTrack(rowTrack.id)
          setFocusTab('notes')
          setTimeout(() => setFocusTab(null), 0)
        },
      },
      {
        id: 'archive',
        icon: rowTrack.isArchived ? ArchiveRestore : Archive,
        label: isMulti
          ? `Archive ${opIds.length} tracks`
          : rowTrack.isArchived
            ? 'Restore'
            : 'Archive',
        separator: true,
        onSelect: () => {
          if (isMulti) setBulkArchiveIds(opIds)
          else if (rowTrack.isArchived) restore.mutate(rowTrack.id)
          else setArchiveTarget(rowTrack)
        },
      },
      {
        id: 'cleanup',
        icon: AlertTriangle,
        label: 'Cleanup…',
        disabled:
          isMulti ||
          rowTrack.audioVersion === 'normalized' ||
          (!rowTrack.isDirtyName && !rowTrack.isMissingMetadata),
        disabledReason: isMulti
          ? 'Single track only'
          : rowTrack.audioVersion === 'normalized'
            ? 'Switch to original before cleanup'
            : 'No cleanup suggested',
        onSelect: () => setCleanupTarget(rowTrack),
      },
      {
        id: 'reveal',
        icon: ExternalLink,
        label: 'Reveal in Explorer',
        disabled: isMulti || !bridgeAvailable(),
        disabledReason: isMulti ? 'Single track only' : 'Only available in the desktop shell',
        separator: true,
        onSelect: () => {
          void bridge.openInExplorer(rowTrack.filePath)
        },
      },
      {
        id: 'relink',
        icon: ExternalLink,
        label: 'Relink audio file…',
        disabled: isMulti,
        disabledReason: 'Select one track to relink',
        onSelect: () => useTrackFileDialog.getState().open(rowTrack, 'relink'),
      },
      {
        id: 'remove',
        icon: X,
        label: 'Remove from WISP…',
        disabled: isMulti,
        disabledReason: 'Select one track to remove',
        onSelect: () => useTrackFileDialog.getState().open(rowTrack, 'remove'),
      },
    ]
  }

  const onContextMenuRow = (t: Track, x: number, y: number) => {
    if (!(selectedIds.has(trackRowId(t)) && selectedIds.size > 1)) {
      setSelected(t)
      setSelectedIds(new Set([trackRowId(t)]))
      anchorIdRef.current = trackRowId(t)
    }
    setContextMenu({ track: t, x, y })
  }

  const bulkAddToMix = () => {
    if (!activePlanId) return
    for (const id of selectedTrackIds) addToActivePlan(id)
    clearSelection()
  }
  const bulkArchive = () => setBulkArchiveIds(selectedTrackIds)
  const bulkTag = () => setBulkTagIds(selectedTrackIds)
  const bulkAddToPlaylist = () => setAddToPlaylistIds(selectedTrackIds)

  // Keyboard shortcuts. Skipped while typing in inputs / textareas.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        e.defaultPrevented ||
        document.querySelector('dialog:modal') ||
        target?.closest('[role="menu"]')
      )
        return
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      )
        return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        void selectAll()
        return
      }
      if (e.key === 'Escape' && selectedIds.size > 0) {
        clearSelection()
        e.preventDefault()
        return
      }
      if (target?.closest('button, [role="separator"]')) return
      if (e.key === 'r' || e.key === 'R') {
        if (selected) {
          // Load the highlighted row into the workspace + focus the Recommendations tab.
          loadTrack(selected.id)
          setFocusTab('recommendations')
          setTimeout(() => setFocusTab(null), 0)
          e.preventDefault()
        }
        return
      }
      // Spacebar is the universal "play/pause" hotkey. `P` stays as an alias.
      // Skipping when typing in inputs is already handled at the top of the
      // handler — important for spacebar especially since textareas need it.
      if (e.key === ' ' || e.key === 'p' || e.key === 'P') {
        togglePlay()
        // preventDefault on space stops the page from scrolling underneath.
        e.preventDefault()
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length > 0) {
        const idx = selected ? items.findIndex((t) => trackRowId(t) === trackRowId(selected)) : -1
        const next =
          e.key === 'ArrowDown' ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1)
        const nt = items[next]
        if (nt) {
          if (e.shiftKey && anchorIdRef.current) {
            const ids = items.map(trackRowId)
            const aIdx = ids.indexOf(anchorIdRef.current)
            const [lo, hi] = aIdx < next ? [aIdx, next] : [next, aIdx]
            setSelectedIds(new Set(ids.slice(lo, hi + 1)))
            setSelected(nt)
          } else {
            setSelected(nt)
            setSelectedIds(new Set([trackRowId(nt)]))
            anchorIdRef.current = trackRowId(nt)
          }
          setFocusTab(null)
          e.preventDefault()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, items, togglePlay, selectedIds.size, scopeKey])

  // First-launch / cleared-library state — bumps the user toward Scan or away from
  // an empty Library so they don't sit looking at a blank panel.
  if (showLibraryEmptyState && !workspaceActive && !activePlaylistId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-3xl font-semibold tracking-tight">Your library is empty</div>
        <p className="max-w-md text-sm text-[var(--color-muted)]">
          Pick a folder of analysed tracks to start. Wisp reads BPM, key and energy from Mixed in
          Key tags — no audio analysis required.
        </p>
        <button
          onClick={pickAndScan}
          disabled={!bridgeAvailable()}
          className="rounded-md bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Pick a folder
        </button>
        {!bridgeAvailable() && (
          <p className="text-xs text-[var(--color-muted)]">
            The folder picker only works in the desktop shell — launch via Wisp.exe.
          </p>
        )}
        <button
          onClick={() => setPage('crate-digger')}
          className="text-xs text-[var(--color-muted)] underline-offset-2 hover:text-white hover:underline"
        >
          …or jump to Crate Digger to start discovering tracks first
        </button>
      </div>
    )
  }

  return (
    <div className="library-workspace flex h-full min-h-0 flex-col">
      <header className="library-heading">
        <div className="min-w-0 flex-1">
          <h1 className="truncate" data-ui-tooltip={activePlaylist?.name}>
            {activePlaylist?.name ?? 'All tracks'}
          </h1>
          <span className="text-xs text-[var(--color-muted)]">
            {tracksQuery.isError
              ? 'Library unavailable'
              : tracksQuery.isLoading
                ? 'Loading tracks…'
                : `${total.toLocaleString()} ${activePlaylistId ? 'playlist entries' : 'tracks'}${tracksQuery.isFetching ? ' · Updating…' : ''}`}
          </span>
        </div>
        {activePlaylist && (
          <>
            <CdjExportButton
              source="playlist"
              sourceId={activePlaylist.id}
              sourceName={activePlaylist.name}
              disabled={activePlaylist.trackCount === 0}
            />
            <Button small onClick={() => setActivePlaylistId(null)}>
              All tracks
            </Button>
          </>
        )}
        <Button small onClick={toggleFilters} aria-expanded={filtersVisible}>
          <SlidersHorizontal size={16} />
          {filtersVisible ? 'Hide filters' : 'Show filters'}
          {hasActiveFilters ? ' · active' : ''}
        </Button>
        <Button small onClick={() => setColumnsOpen(true)}>
          <Columns3 size={16} />
          Columns
        </Button>
      </header>
      {/* Preparation is explicit. Keep it mounted after first opening so
          Focus list preserves zoom and unsaved editor drafts. */}
      {prepMounted && playerTrackId && (
        <ResizablePrepPane visible={workspaceActive}>
          <TrackPrepWorkspace
            active={workspaceActive}
            onAddToChain={activePlanId ? addToActivePlan : undefined}
            onCleanup={setCleanupTarget}
            onArchive={onArchiveOrRestore}
            focusTab={focusTab ?? undefined}
          />
        </ResizablePrepPane>
      )}

      <div className="library-toolbar">
        {selectedIds.size === 0 ? (
          <label className="library-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search tracks</span>
            <input
              value={query.search ?? ''}
              onChange={(e) =>
                changeQuery({ ...query, search: e.target.value || undefined, page: 1 })
              }
              placeholder="Search artist / title / album"
            />
          </label>
        ) : (
          <div className="library-selection-actions">
            <span className="whitespace-nowrap text-sm">{selectedIds.size} tracks selected</span>
            <Button
              small
              disabled={!activePlanId}
              tooltip={activePlanId ? 'Add selection to active plan' : 'Choose a mix plan first'}
              onClick={bulkAddToMix}
            >
              <Plus size={16} />
              Add to mix
            </Button>
            <Button small onClick={bulkAddToPlaylist}>
              <ListMusic size={16} />
              Add to playlist…
            </Button>
            <IconButton small label="Clear selection" variant="quiet" onClick={clearSelection}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        <Button
          small
          disabled={selectingAll || total === 0}
          onClick={() => void selectAll()}
          tooltip="Select every matching track, across all pages (Ctrl+A)"
        >
          {selectingAll ? 'Selecting all pages…' : `Select all ${total.toLocaleString()} tracks`}
        </Button>
        {selectingAll && (
          <button onClick={() => selectionRequest.current?.abort()} className="underline">
            Cancel selection
          </button>
        )}
        <ExternalFileDrag key={scopeKey} ids={selectedTrackIds} controller={fileDrag} />
        <ActionMenu
          label="Library actions"
          icon={<MoreHorizontal />}
          items={[
            ...(selectedIds.size === 1 && selected
              ? [{ label: 'Prepare track', onSelect: () => loadTrack(selected.id) }]
              : []),
            ...(selectedTrackIds.length
              ? [
                  {
                    label: 'Loudness & versions…',
                    onSelect: () => setLoudnessIds(selectedTrackIds),
                  },
                  { label: 'Tag selection…', onSelect: bulkTag },
                  { label: 'Archive selection…', onSelect: bulkArchive },
                ]
              : []),
            ...(activePlaylistId && selectedRows.length
              ? [
                  {
                    label: 'Remove from playlist…',
                    onSelect: () => removeFromPlaylist(selectedRows),
                  },
                ]
              : []),
            ...(activePlaylist
              ? [
                  {
                    label: 'Scan for duplicates…',
                    onSelect: () =>
                      setDuplicateScan({ id: activePlaylist.id, name: activePlaylist.name }),
                  },
                ]
              : []),
            {
              label: 'Reset filters',
              onSelect: () => changeQuery({ page: 1, size: query.size, sort: query.sort }),
            },
          ]}
        />
        {selectionError && (
          <span role="alert" className="basis-full text-red-300">
            {selectionError}
          </span>
        )}
        {playlistNotice?.scope === scopeKey && (
          <span role="status" className="basis-full text-[var(--color-muted)]">
            {playlistNotice.message}
          </span>
        )}
      </div>
      {filtersVisible && (
        <div className="library-advanced-filters">
          <LibraryFilters query={query} onChange={changeQuery} total={total} />
        </div>
      )}
      {tracksQuery.isError && (
        <StatusMessage tone="error">
          Could not load the library: {tracksQuery.error.message}{' '}
          <Button small onClick={() => void tracksQuery.refetch()}>
            Retry library
          </Button>
        </StatusMessage>
      )}
      {columnsOpen && (
        <LibraryColumnsDialog
          onClose={() => setColumnsOpen(false)}
          onPreset={(preset) => {
            if (preset === 'recent') changeQuery({ ...query, page: 1, sort: '-added' })
          }}
        />
      )}
      <div className="min-h-20 flex-1" aria-label="Library track list">
        <LibraryTable
          tracks={items}
          loading={tracksQuery.isLoading}
          error={tracksQuery.isError}
          selectedId={selected ? trackRowId(selected) : null}
          selectedIds={selectedIds}
          sort={query.sort}
          onSortChange={(next) => changeQuery({ ...query, sort: next, page: 1 })}
          onSelect={onSelectRow}
          onActivate={onActivateRow}
          onAddToChain={activePlanId ? addToActivePlan : undefined}
          onCleanup={setCleanupTarget}
          onContextMenu={onContextMenuRow}
          onDragStartRow={onDragStartRow}
          onNativeDrag={
            fileDrag.unified
              ? (ids) => {
                  void fileDrag.begin(ids, true)
                }
              : undefined
          }
        />
      </div>
      {total > (query.size ?? 500) && (
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--color-border)] px-4 py-1 text-xs">
          <span>
            Page {query.page ?? 1} of {Math.ceil(total / (query.size ?? 500))}
          </span>
          <button
            disabled={(query.page ?? 1) <= 1}
            onClick={() => changeQuery({ ...query, page: (query.page ?? 1) - 1 })}
            className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
          >
            Previous page
          </button>
          <button
            disabled={(query.page ?? 1) * (query.size ?? 500) >= total}
            onClick={() => changeQuery({ ...query, page: (query.page ?? 1) + 1 })}
            className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-40"
          >
            Next page
          </button>
        </div>
      )}

      {cleanupTarget && (
        <CleanupModal
          trackId={cleanupTarget.id}
          trackLabel={`${cleanupTarget.artist ?? 'Unknown'} — ${cleanupTarget.title ?? cleanupTarget.fileName}`}
          onClose={() => setCleanupTarget(null)}
          onApplied={(audit) => setRecentAudit(audit)}
        />
      )}
      {playlistRemoval && (
        <RemoveFromPlaylistDialog
          target={playlistRemoval}
          onClose={() => setPlaylistRemoval(null)}
          onRemoved={(count) => {
            clearSelection()
            setQuery((q) => ({ ...q, page: 1 }))
            setPlaylistNotice({
              scope: scopeKey,
              message: `${count} playlist ${count === 1 ? 'entry' : 'entries'} removed. Your library and audio files are unchanged.`,
            })
          }}
        />
      )}

      {duplicateScan && (
        <PlaylistDuplicatesDialog
          key={duplicateScan.id}
          playlistId={duplicateScan.id}
          playlistName={duplicateScan.name}
          onClose={() => setDuplicateScan(null)}
          onRemoved={(count) => {
            clearSelection()
            changeQuery({ ...query, page: 1 })
            setPlaylistNotice({
              scope: scopeKey,
              message: `${count} duplicate playlist ${count === 1 ? 'entry' : 'entries'} removed. One entry per track kept; your library and audio files are unchanged.`,
            })
          }}
        />
      )}

      {loudnessIds && <LoudnessDialog ids={loudnessIds} onClose={() => setLoudnessIds(null)} />}

      {recentAudit && <UndoToast audit={recentAudit} onDismiss={() => setRecentAudit(null)} />}

      {archiveTarget && (
        <ArchiveModal
          track={archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onArchived={() => {
            if (selected?.id === archiveTarget.id) setSelected(null)
          }}
        />
      )}

      {bulkArchiveIds && (
        <ArchiveModal
          trackIds={bulkArchiveIds}
          onClose={() => setBulkArchiveIds(null)}
          onArchivedBulk={() => {
            clearSelection()
            setBulkArchiveIds(null)
          }}
        />
      )}

      {bulkTagIds && (
        <BulkTagDialog
          trackIds={bulkTagIds}
          onClose={() => setBulkTagIds(null)}
          onApplied={() => {
            clearSelection()
            setBulkTagIds(null)
          }}
        />
      )}

      {addToPlaylistIds && (
        <AddToPlaylistDialog
          trackIds={addToPlaylistIds}
          onClose={() => setAddToPlaylistIds(null)}
          onAdded={() => clearSelection()}
        />
      )}

      {contextMenu && (
        <RowContextMenu
          items={buildMenuItems(contextMenu.track)}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}
