import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tracks } from '../../api/library'
import type { Track, TrackQuery } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { useActivePlan } from '../../state/activePlan'
import { useCurrentPage } from '../../state/currentPage'
import { usePlayer } from '../../state/player'
import type { InspectorTab } from '../../state/uiPrefs'
import { ArchiveModal } from '../archive/ArchiveModal'
import { CleanupModal } from '../cleanup/CleanupModal'
import { UndoToast } from '../cleanup/UndoToast'
import { TrackInspector } from '../inspector/TrackInspector'
import { useMixPlan } from '../mixchain/useMixPlans'
import { BulkActionBar } from './BulkActionBar'
import { BulkTagDialog } from './BulkTagDialog'
import { LibraryFilters } from './LibraryFilters'
import { LibraryTable } from './LibraryTable'
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu'
import { useScan } from './useScan'

/// Library content for the routed App layout — no top-nav, no chain dock,
/// no mini-player. Those are App-level fixtures. This component owns the
/// library body: filters, bulk bar, table, inspector, plus modals scoped
/// to library actions (cleanup, archive, bulk archive, bulk tag, context menu).
export function LibraryPage() {
  const [query, setQuery] = useState<TrackQuery>({ page: 1, size: 500 })
  const [selected, setSelected] = useState<Track | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const anchorIdRef = useRef<string | null>(null)
  const [focusTab, setFocusTab] = useState<InspectorTab | null>(null)
  const [cleanupTarget, setCleanupTarget] = useState<Track | null>(null)
  const [recentAudit, setRecentAudit] = useState<import('../../api/types').AuditEntry | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Track | null>(null)
  const [bulkArchiveIds, setBulkArchiveIds] = useState<string[] | null>(null)
  const [bulkTagIds, setBulkTagIds] = useState<string[] | null>(null)
  const [contextMenu, setContextMenu] = useState<{ track: Track; x: number; y: number } | null>(null)

  const qc = useQueryClient()
  const setPage = useCurrentPage((s) => s.setPage)
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

  const tracksQuery = useQuery({
    queryKey: ['tracks', query],
    queryFn: () => tracks.list(query),
  })
  const total = tracksQuery.data?.total ?? 0
  const items = tracksQuery.data?.items ?? []

  const hasActiveFilters = !!(
    query.search || query.key || query.bpmMin || query.bpmMax ||
    query.energyMin || query.energyMax || query.missing
  )
  const showLibraryEmptyState = total === 0 && !tracksQuery.isLoading && !hasActiveFilters

  const pickAndScan = async () => {
    if (!bridgeAvailable()) return
    const result = await bridge.pickFolder()
    if (result.path) await scan.start(result.path)
  }

  const onSelectRow = (t: Track, mods: { meta: boolean; shift: boolean }) => {
    setFocusTab(null)
    if (mods.meta) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        if (next.has(t.id)) next.delete(t.id)
        else next.add(t.id)
        return next
      })
      anchorIdRef.current = t.id
      setSelected(t)
      return
    }
    if (mods.shift && anchorIdRef.current) {
      const ids = items.map((x) => x.id)
      const aIdx = ids.indexOf(anchorIdRef.current)
      const bIdx = ids.indexOf(t.id)
      if (aIdx >= 0 && bIdx >= 0) {
        const [lo, hi] = aIdx < bIdx ? [aIdx, bIdx] : [bIdx, aIdx]
        setSelectedIds(new Set(ids.slice(lo, hi + 1)))
        setSelected(t)
        return
      }
    }
    setSelected(t)
    setSelectedIds(new Set([t.id]))
    anchorIdRef.current = t.id
  }
  const onActivateRow = (t: Track) => playTrack(t.id)
  const clearSelection = () => {
    setSelected(null)
    setSelectedIds(new Set())
    anchorIdRef.current = null
  }

  const onDragStartRow = (t: Track): Track[] => {
    if (selectedIds.has(t.id) && selectedIds.size > 1) {
      return items.filter((x) => selectedIds.has(x.id))
    }
    setSelected(t)
    setSelectedIds(new Set([t.id]))
    anchorIdRef.current = t.id
    return [t]
  }

  const inspectorTarget = selectedIds.size > 1 ? null : selected

  const buildMenuItems = (rowTrack: Track): ContextMenuItem[] => {
    const opIds = selectedIds.has(rowTrack.id) && selectedIds.size > 1
      ? Array.from(selectedIds)
      : [rowTrack.id]
    const isMulti = opIds.length > 1
    const hasPlan = !!activePlanId
    return [
      {
        id: 'play', icon: '▶', label: 'Play',
        disabled: isMulti, disabledReason: 'Single track only',
        onSelect: () => playTrack(rowTrack.id),
      },
      {
        id: 'add', icon: '+', label: isMulti ? `Add ${opIds.length} to mix` : 'Add to mix',
        disabled: !hasPlan, disabledReason: 'Pick or create an active mix plan first',
        onSelect: () => { for (const id of opIds) addToActivePlan(id) },
      },
      {
        id: 'find', icon: '✨', label: 'Find matches',
        disabled: isMulti, disabledReason: 'Single track only',
        onSelect: () => {
          setSelected(rowTrack)
          setSelectedIds(new Set([rowTrack.id]))
          setFocusTab('recommendations')
          setTimeout(() => setFocusTab(null), 0)
        },
      },
      {
        id: 'tag', icon: '🏷', label: isMulti ? `Tag ${opIds.length} tracks…` : 'Tag…',
        separator: true,
        onSelect: () => {
          if (isMulti) setBulkTagIds(opIds)
          else {
            setSelected(rowTrack)
            setSelectedIds(new Set([rowTrack.id]))
            setFocusTab('tags')
            setTimeout(() => setFocusTab(null), 0)
          }
        },
      },
      {
        id: 'notes', icon: '📝', label: 'Notes',
        disabled: isMulti, disabledReason: 'Single track only',
        onSelect: () => {
          setSelected(rowTrack)
          setSelectedIds(new Set([rowTrack.id]))
          setFocusTab('notes')
          setTimeout(() => setFocusTab(null), 0)
        },
      },
      {
        id: 'archive',
        icon: rowTrack.isArchived ? '♻' : '📦',
        label: isMulti ? `Archive ${opIds.length} tracks` : rowTrack.isArchived ? 'Restore' : 'Archive',
        separator: true,
        onSelect: () => {
          if (isMulti) setBulkArchiveIds(opIds)
          else if (rowTrack.isArchived) restore.mutate(rowTrack.id)
          else setArchiveTarget(rowTrack)
        },
      },
      {
        id: 'cleanup', icon: '⚠', label: 'Cleanup…',
        disabled: isMulti || (!rowTrack.isDirtyName && !rowTrack.isMissingMetadata),
        disabledReason: isMulti ? 'Single track only' : 'No cleanup suggested',
        onSelect: () => setCleanupTarget(rowTrack),
      },
      {
        id: 'reveal', icon: '↗', label: 'Reveal in Explorer',
        disabled: isMulti || !bridgeAvailable(),
        disabledReason: isMulti ? 'Single track only' : 'Only available in the desktop shell',
        separator: true,
        onSelect: () => { void bridge.openInExplorer(rowTrack.filePath) },
      },
    ]
  }

  const onContextMenuRow = (t: Track, x: number, y: number) => {
    if (!(selectedIds.has(t.id) && selectedIds.size > 1)) {
      setSelected(t)
      setSelectedIds(new Set([t.id]))
      anchorIdRef.current = t.id
    }
    setContextMenu({ track: t, x, y })
  }

  const bulkAddToMix = () => {
    if (!activePlanId) return
    for (const id of selectedIds) addToActivePlan(id)
    clearSelection()
  }
  const bulkArchive = () => setBulkArchiveIds(Array.from(selectedIds))
  const bulkTag = () => setBulkTagIds(Array.from(selectedIds))

  // Keyboard shortcuts. Skipped while typing in inputs / textareas.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'Escape' && selectedIds.size > 0) {
        clearSelection()
        e.preventDefault()
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        if (selected) {
          setFocusTab('recommendations')
          setTimeout(() => setFocusTab(null), 0)
          e.preventDefault()
        }
        return
      }
      if (e.key === 'p' || e.key === 'P') {
        togglePlay()
        e.preventDefault()
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length > 0) {
        const idx = selected ? items.findIndex((t) => t.id === selected.id) : -1
        const next = e.key === 'ArrowDown'
          ? Math.min(items.length - 1, idx + 1)
          : Math.max(0, idx - 1)
        const nt = items[next]
        if (nt) {
          if (e.shiftKey && anchorIdRef.current) {
            const ids = items.map((x) => x.id)
            const aIdx = ids.indexOf(anchorIdRef.current)
            const [lo, hi] = aIdx < next ? [aIdx, next] : [next, aIdx]
            setSelectedIds(new Set(ids.slice(lo, hi + 1)))
            setSelected(nt)
          } else {
            setSelected(nt)
            setSelectedIds(new Set([nt.id]))
            anchorIdRef.current = nt.id
          }
          setFocusTab(null)
          e.preventDefault()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, items, togglePlay, selectedIds.size])

  // First-launch / cleared-library state — bumps the user toward Scan or away from
  // an empty Library so they don't sit looking at a blank panel.
  if (showLibraryEmptyState) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="text-3xl font-semibold tracking-tight">Your library is empty</div>
        <p className="max-w-md text-sm text-[var(--color-muted)]">
          Pick a folder of analysed tracks to start. Wisp reads BPM, key and energy from
          Mixed in Key tags — no audio analysis required.
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
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <LibraryFilters query={query} onChange={setQuery} total={total} />
        {selectedIds.size > 1 && (
          <BulkActionBar
            count={selectedIds.size}
            hasActivePlan={!!activePlanId}
            onAddToMix={bulkAddToMix}
            onArchive={bulkArchive}
            onTag={bulkTag}
            onClear={clearSelection}
          />
        )}
        <div className="min-h-0 flex-1">
          <LibraryTable
            tracks={items}
            loading={tracksQuery.isLoading}
            selectedId={selected?.id ?? null}
            selectedIds={selectedIds}
            sort={query.sort}
            onSortChange={(next) => setQuery((q) => ({ ...q, sort: next, page: 1 }))}
            onSelect={onSelectRow}
            onActivate={onActivateRow}
            onAddToChain={activePlanId ? addToActivePlan : undefined}
            onCleanup={setCleanupTarget}
            onContextMenu={onContextMenuRow}
            onDragStartRow={onDragStartRow}
          />
        </div>
      </div>
      {inspectorTarget && (
        <TrackInspector
          track={inspectorTarget}
          onClose={() => setSelected(null)}
          onAddToChain={activePlanId ? addToActivePlan : undefined}
          onCleanup={setCleanupTarget}
          onArchive={onArchiveOrRestore}
          focusTab={focusTab ?? undefined}
        />
      )}

      {cleanupTarget && (
        <CleanupModal
          trackId={cleanupTarget.id}
          trackLabel={`${cleanupTarget.artist ?? 'Unknown'} — ${cleanupTarget.title ?? cleanupTarget.fileName}`}
          onClose={() => setCleanupTarget(null)}
          onApplied={(audit) => setRecentAudit(audit)}
        />
      )}

      {recentAudit && (
        <UndoToast audit={recentAudit} onDismiss={() => setRecentAudit(null)} />
      )}

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
