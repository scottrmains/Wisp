import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { tracks } from '../../api/library'
import type { AuditEntry, Track, TrackQuery } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { useActivePlan } from '../../state/activePlan'
import { usePlayer } from '../../state/player'
import type { InspectorTab } from '../../state/uiPrefs'
import { ArchiveModal } from '../archive/ArchiveModal'
import { CleanupModal } from '../cleanup/CleanupModal'
import { UndoToast } from '../cleanup/UndoToast'
import { CrateDiggerPage } from '../cratedigger/CrateDiggerPage'
import { TrackInspector } from '../inspector/TrackInspector'
import { ChainDock } from '../mixchain/ChainDock'
import { MixPlansPage } from '../mixchain/MixPlansPage'
import { PlanSwitcher } from '../mixchain/PlanSwitcher'
import { useMixPlan } from '../mixchain/useMixPlans'
import { RediscoverScreen } from '../rediscover/RediscoverScreen'
import { SettingsPanel } from '../settings/SettingsPanel'
import { BulkActionBar } from './BulkActionBar'
import { BulkTagDialog } from './BulkTagDialog'
import { LibraryFilters } from './LibraryFilters'
import { LibraryTable } from './LibraryTable'
import { RowContextMenu, type ContextMenuItem } from './RowContextMenu'
import { ScanToast } from './ScanToast'
import { useScan } from './useScan'

export function LibraryPage() {
  const [query, setQuery] = useState<TrackQuery>({ page: 1, size: 500 })
  const [selected, setSelected] = useState<Track | null>(null)
  // Multi-select store — a Set of track ids. `selected` (single) is always either null
  // or in this set; the inspector hides when the set has more than one entry.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  // Anchor row for shift-range selection. Updated on plain click; null after Esc.
  const anchorIdRef = useRef<string | null>(null)
  // `focusTab` is a one-shot signal — when it changes the inspector snaps to that tab.
  // Setting `null` between explicit requests means "use whatever the inspector remembers"
  // so re-selecting a row preserves the user's last tab.
  const [focusTab, setFocusTab] = useState<InspectorTab | null>(null)
  const [chainCollapsed, setChainCollapsed] = useState(false)
  const [cleanupTarget, setCleanupTarget] = useState<Track | null>(null)
  const [recentAudit, setRecentAudit] = useState<AuditEntry | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rediscoverOpen, setRediscoverOpen] = useState(false)
  const [crateDiggerOpen, setCrateDiggerOpen] = useState(false)
  const [mixPlansOpen, setMixPlansOpen] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Track | null>(null)
  const [bulkArchiveIds, setBulkArchiveIds] = useState<string[] | null>(null)
  const [bulkTagIds, setBulkTagIds] = useState<string[] | null>(null)
  const [contextMenu, setContextMenu] = useState<{ track: Track; x: number; y: number } | null>(null)
  const qc = useQueryClient()
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

  // "Library is empty" is a different concept from "current filter matches nothing".
  // If any filter is set we keep the filter bar visible so the user can clear it.
  const hasActiveFilters = !!(
    query.search ||
    query.key ||
    query.bpmMin ||
    query.bpmMax ||
    query.energyMin ||
    query.energyMax ||
    query.missing
  )
  const showLibraryEmptyState = total === 0 && !tracksQuery.isLoading && !hasActiveFilters

  const pickAndScan = async () => {
    if (!bridgeAvailable()) return
    const result = await bridge.pickFolder()
    if (result.path) await scan.start(result.path)
  }

  // Modifier-aware row click: Cmd/Ctrl toggles, Shift extends from the anchor, plain click replaces.
  // Double click stays as "load + play in mini-player".
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
      // Promote to single-select inspector target if this leaves us at exactly one row.
      setSelected(t)
      return
    }
    if (mods.shift && anchorIdRef.current) {
      // Range select using the current items array order.
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
    // Plain click — replace selection with this single row.
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

  // Drag-start on a row resolves the effective drag set: if the row is in the current
  // multi-selection, drag the whole selection; otherwise drag just the row (and
  // synchronously upgrade the selection to that row so the visual matches the drag).
  const onDragStartRow = (t: Track): Track[] => {
    if (selectedIds.has(t.id) && selectedIds.size > 1) {
      // Preserve the items-order so dropped tracks land in the user's expected sequence.
      return items.filter((x) => selectedIds.has(x.id))
    }
    setSelected(t)
    setSelectedIds(new Set([t.id]))
    anchorIdRef.current = t.id
    return [t]
  }

  // Effective inspector target: nothing when multi-selected (bulk bar handles those).
  const inspectorTarget = selectedIds.size > 1 ? null : selected

  // Build the right-click menu items — selection-aware.
  const buildMenuItems = (rowTrack: Track): ContextMenuItem[] => {
    // If the right-click landed on a row outside the current selection, we already
    // replaced selection with that row in `onContextMenuRow` below, so the effective
    // operating set always includes `rowTrack` here.
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
        onSelect: () => {
          for (const id of opIds) addToActivePlan(id)
        },
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
        label: isMulti
          ? `Archive ${opIds.length} tracks`
          : rowTrack.isArchived ? 'Restore' : 'Archive',
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
    // Replace selection with the right-clicked row UNLESS it's already in a multi-selection.
    if (!(selectedIds.has(t.id) && selectedIds.size > 1)) {
      setSelected(t)
      setSelectedIds(new Set([t.id]))
      anchorIdRef.current = t.id
    }
    setContextMenu({ track: t, x, y })
  }

  // Bulk handlers wired to the action bar.
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

      // Esc → clear multi-selection FIRST (then the inspector / modal close themselves on a second press).
      if (e.key === 'Escape' && selectedIds.size > 0) {
        clearSelection()
        e.preventDefault()
        return
      }
      // R → Recommendations tab on the selected track.
      if (e.key === 'r' || e.key === 'R') {
        if (selected) {
          // Bump a fresh sentinel each time — same value wouldn't re-trigger the prop effect.
          setFocusTab('recommendations')
          // Clear next tick so the user can change tabs by hand and still get another R.
          setTimeout(() => setFocusTab(null), 0)
          e.preventDefault()
        }
        return
      }
      // P / Space → toggle play (only meaningful once a track is loaded).
      if (e.key === 'p' || e.key === 'P') {
        togglePlay()
        e.preventDefault()
      }
      // ↑/↓ → move row selection. Shift extends the selection.
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
  // clearSelection is a stable closure but referenced — selectedIds.size triggers re-bind on change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, items, togglePlay, selectedIds.size])

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        {/* Brand + sections (modules) */}
        <div className="flex items-center gap-6">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Wisp</h1>
          </div>
          <nav className="flex items-center gap-1 text-sm">
            <NavButton active>Library</NavButton>
            <NavButton onClick={() => setMixPlansOpen(true)}>Mix Plans</NavButton>
            <NavButton onClick={() => setRediscoverOpen(true)}>Rediscover</NavButton>
            <NavButton onClick={() => setCrateDiggerOpen(true)}>Crate Digger</NavButton>
          </nav>
        </div>

        {/* Active plan switcher + actions, separated by the divider */}
        <div className="flex items-center gap-3">
          <PlanSwitcher />
          <span className="h-6 w-px bg-[var(--color-border)]" aria-hidden />
          <button
            onClick={pickAndScan}
            disabled={!bridgeAvailable() || scan.active}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            title={bridgeAvailable() ? 'Pick a folder and scan' : 'Folder picker only works inside Photino'}
          >
            {scan.active ? 'Scanning…' : 'Scan folder'}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-muted)] hover:text-white"
            aria-label="Settings"
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      {showLibraryEmptyState ? (
        <EmptyState onPick={pickAndScan} canPick={bridgeAvailable()} />
      ) : (
        <div className="flex min-h-0 flex-1">
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
        </div>
      )}

      {activePlanId && (
        <ChainDock
          planId={activePlanId}
          collapsed={chainCollapsed}
          onToggle={() => setChainCollapsed((c) => !c)}
        />
      )}

      <ScanToast
        progress={scan.progress}
        error={scan.error}
        active={scan.active}
        onDismiss={scan.dismiss}
      />

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

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {rediscoverOpen && <RediscoverScreen onClose={() => setRediscoverOpen(false)} />}
      {crateDiggerOpen && <CrateDiggerPage onClose={() => setCrateDiggerOpen(false)} />}
      {mixPlansOpen && <MixPlansPage onClose={() => setMixPlansOpen(false)} />}
      {archiveTarget && (
        <ArchiveModal
          track={archiveTarget}
          onClose={() => setArchiveTarget(null)}
          onArchived={() => {
            // If we just archived the selected row, drop the inspector since it's no longer in the active list.
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

function NavButton({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick?: () => void
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

function EmptyState({ onPick, canPick }: { onPick: () => void; canPick: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-3xl font-semibold tracking-tight">Your library is empty</div>
      <p className="max-w-md text-sm text-[var(--color-muted)]">
        Pick a folder of analysed tracks to start. Wisp reads BPM, key and energy from
        Mixed in Key tags — no audio analysis required.
      </p>
      <button
        onClick={onPick}
        disabled={!canPick}
        className="rounded-md bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        Pick a folder
      </button>
      {!canPick && (
        <p className="text-xs text-[var(--color-muted)]">
          The folder picker only works in the desktop shell — launch via Wisp.exe.
        </p>
      )}
    </div>
  )
}
