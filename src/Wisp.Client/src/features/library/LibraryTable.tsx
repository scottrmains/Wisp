import { Children, useRef, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, Play, Plus } from 'lucide-react'
import type { Track } from '../../api/types'
import { usePlayer } from '../../state/player'
import { formatDuration, formatTrackDate } from './format'
import { BpmPill, EnergyPill, KeyPill } from './pills'
import { trackRowId } from './librarySelection'
import { useUiPrefs } from '../../state/uiPrefs'
import { columnWidth, libraryColumns, type LibraryColumnKey } from './libraryColumns'

interface Props {
  tracks: Track[]
  loading: boolean
  error?: boolean
  /// Single-row "primary" selection — drives the inspector. Subset of `selectedIds`.
  selectedId?: string | null
  /// Selected occurrence IDs; selection never changes the playing track.
  selectedIds?: ReadonlySet<string>
  /// Current sort key as the backend understands it (e.g. `bpm`, `-bpm`, `key`, `-key`).
  /// Undefined means "default" (artist asc).
  sort?: string
  onSortChange?: (next: string | undefined) => void
  /// Click handler — fires with the modifier keys so the parent can implement
  /// Cmd-toggle / Shift-range / plain-replace selection semantics.
  onSelect?: (track: Track, modifiers: { meta: boolean; shift: boolean }) => void
  onActivate?: (track: Track) => void
  onAddToChain?: (trackId: string) => void
  onCleanup?: (track: Track) => void
  /// Right-click on a row. Coordinates are page-relative (clientX/clientY).
  onContextMenu?: (track: Track, x: number, y: number) => void
  /// Called at dragstart on a row. Parent should resolve the effective drag set
  /// (the row itself if not in selection, otherwise the whole selection) and return
  /// the ordered list of track ids to attach to the dataTransfer payload.
  onDragStartRow?: (track: Track) => Track[]
  /// Windows hosts offer both native files and WISP IDs in ONE drag session.
  /// Omit on browser/older hosts to retain the ordinary internal HTML drag.
  onNativeDrag?: (ids: string[]) => void
}

interface Column {
  key: LibraryColumnKey
  label: string
  align?: 'right'
  sortKey?: string
}

const columns: Column[] = libraryColumns.map((c) => ({
  ...c,
  label: c.key === 'actions' || c.key === 'flags' ? '' : c.label,
  align: c.key === 'bpm' || c.key === 'duration' ? 'right' : undefined,
}))

const ROW_HEIGHT = 36

export function LibraryTable({
  tracks,
  loading,
  error,
  selectedId,
  selectedIds,
  sort,
  onSortChange,
  onSelect,
  onActivate,
  onAddToChain,
  onCleanup,
  onContextMenu,
  onDragStartRow,
  onNativeDrag,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const playTrack = usePlayer((s) => s.playTrack)
  const prefs = useUiPrefs((s) => s.libraryColumns)
  const setPrefs = useUiPrefs((s) => s.setLibraryColumns)
  const resize = useRef<{ x: number; width: number; key: LibraryColumnKey } | null>(null)
  const visibleColumns = columns.filter((c) => prefs.visible.includes(c.key as LibraryColumnKey))
  const widths = visibleColumns.map(
    (c) =>
      prefs.widths[c.key as LibraryColumnKey] ?? libraryColumns.find((x) => x.key === c.key)!.width,
  )
  const gridTemplate = visibleColumns
    .map((c, i) => (c.key === 'title' ? `minmax(${widths[i]}px, 1fr)` : `${widths[i]}px`))
    .join(' ')
  const gridWidth = widths.reduce((sum, width) => sum + width, 0)
  const updateWidth = (key: LibraryColumnKey, width: number) =>
    setPrefs({
      ...prefs,
      preset: 'custom',
      widths: { ...prefs.widths, [key]: columnWidth(key, width) },
    })
  const isMultiSelected = (id: string) => selectedIds?.has(id) ?? false

  // asc → desc → off, parameterised on the column's sort key.
  const cycleSort = (sortKey: string) => {
    if (!onSortChange) return
    if (sortKey === 'added' || sortKey === 'modified') {
      onSortChange(sort === `-${sortKey}` ? sortKey : `-${sortKey}`)
      return
    }
    if (sort === sortKey) onSortChange(`-${sortKey}`)
    else if (sort === `-${sortKey}`) onSortChange(undefined)
    else onSortChange(sortKey)
  }

  const virt = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  if (loading && tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
        Loading…
      </div>
    )
  }

  if (!loading && tracks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-[var(--color-muted)]">
        <span>
          {error ? 'Your library has not been changed.' : 'No tracks match these filters.'}
        </span>
        <span className="text-xs">
          {error
            ? 'Use Retry library above to load your tracks.'
            : 'Try a wider date range or clear your search and filters.'}
        </span>
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className="h-full overflow-auto"
      data-library-scroll
      role="table"
      aria-label="Library tracks"
      aria-rowcount={tracks.length + 1}
      aria-colcount={visibleColumns.length}
    >
      <div
        role="row"
        aria-rowindex={1}
        className="sticky top-0 z-10 grid border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs uppercase tracking-wide text-[var(--color-muted)]"
        style={{ gridTemplateColumns: gridTemplate, minWidth: gridWidth }}
      >
        {visibleColumns.map((c, i) => {
          const isActive = c.sortKey && (sort === c.sortKey || sort === `-${c.sortKey}`)
          const direction = sort === c.sortKey ? '▲' : sort === `-${c.sortKey}` ? '▼' : null
          return (
            <div
              key={c.key}
              className="relative min-w-0"
              role="columnheader"
              aria-sort={isActive ? (direction === '▲' ? 'ascending' : 'descending') : undefined}
            >
              {c.sortKey ? (
                <button
                  onClick={() => cycleSort(c.sortKey!)}
                  className={[
                    'flex w-full items-center gap-1 overflow-hidden px-3 py-2 hover:text-white',
                    c.align === 'right' ? 'justify-end' : '',
                    isActive ? 'text-[var(--color-accent)]' : '',
                  ].join(' ')}
                  title={`Sort by ${c.label.toLowerCase()}${direction ? ` (currently ${direction === '▲' ? 'ascending' : 'descending'})` : ''}`}
                >
                  <span className="truncate">{c.label}</span>
                  {direction && <span aria-hidden>{direction}</span>}
                </button>
              ) : (
                <div className={`truncate px-3 py-2 ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.key === 'actions' || c.key === 'flags' ? '' : c.label}
                </div>
              )}
              {c.key !== 'actions' && c.key !== 'flags' && (
                <div
                  role="separator"
                  aria-label={`Resize ${c.label} column`}
                  aria-orientation="vertical"
                  aria-valuenow={widths[i]}
                  aria-valuemin={c.key === 'title' || c.key === 'artist' ? 100 : 48}
                  aria-valuemax={600}
                  tabIndex={0}
                  className="library-column-resize"
                  data-ui-tooltip={`Resize ${c.label}: drag or use Left/Right arrow keys. Double-click to reset.`}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.preventDefault()
                    resize.current = {
                      x: e.clientX,
                      width: widths[i],
                      key: c.key as LibraryColumnKey,
                    }
                    e.currentTarget.setPointerCapture(e.pointerId)
                  }}
                  onPointerMove={(e) => {
                    if (resize.current)
                      updateWidth(
                        resize.current.key,
                        resize.current.width + e.clientX - resize.current.x,
                      )
                  }}
                  onPointerUp={(e) => {
                    resize.current = null
                    if (e.currentTarget.hasPointerCapture(e.pointerId))
                      e.currentTarget.releasePointerCapture(e.pointerId)
                  }}
                  onPointerCancel={() => {
                    resize.current = null
                  }}
                  onLostPointerCapture={() => {
                    resize.current = null
                  }}
                  onDoubleClick={() =>
                    updateWidth(
                      c.key as LibraryColumnKey,
                      libraryColumns.find((x) => x.key === c.key)!.width,
                    )
                  }
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                      e.preventDefault()
                      updateWidth(
                        c.key as LibraryColumnKey,
                        widths[i] + (e.key === 'ArrowLeft' ? -16 : 16),
                      )
                    }
                  }}
                />
              )}
            </div>
          )
        })}
      </div>

      <div
        role="rowgroup"
        style={{ height: virt.getTotalSize(), position: 'relative', minWidth: gridWidth }}
      >
        {virt.getVirtualItems().map((vRow) => {
          const t = tracks[vRow.index]
          const rowId = trackRowId(t)
          const isPrimary = selectedId === rowId
          const isInSelection = isMultiSelected(rowId)
          // Either single-selected or part of a multi-selection — both get the accent treatment.
          const isHighlighted = isPrimary || isInSelection
          return (
            <div
              key={rowId}
              data-playlist-entry-id={t.playlistEntryId ?? undefined}
              data-track-id={t.id}
              role="row"
              aria-rowindex={vRow.index + 2}
              tabIndex={onSelect ? 0 : undefined}
              aria-selected={onSelect ? isHighlighted : undefined}
              draggable={!!onDragStartRow}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.stopPropagation()
                  onActivate?.(t)
                }
                if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                  e.preventDefault()
                  e.stopPropagation()
                  const box = e.currentTarget.getBoundingClientRect()
                  onContextMenu?.(t, box.left + 16, box.top + 16)
                }
              }}
              onClick={(e) => {
                onSelect?.(t, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })
              }}
              onDoubleClick={() => onActivate?.(t)}
              onContextMenu={(e) => {
                if (!onContextMenu) return
                e.preventDefault()
                e.currentTarget.focus({ preventScroll: true })
                onContextMenu(t, e.clientX, e.clientY)
              }}
              onDragStart={(e) => {
                if (!onDragStartRow) return
                const ids = onDragStartRow(t)
                if (ids.length === 0) {
                  e.preventDefault()
                  return
                }
                if (onNativeDrag) {
                  // Cancel Chromium's source drag before scheduling the OLE
                  // source. That source carries our same MIME IDs AND CF_HDROP.
                  e.preventDefault()
                  onNativeDrag(ids.map((x) => x.id))
                  return
                }
                e.dataTransfer.effectAllowed = 'copyMove'
                // Browser/older-host fallback remains internal, never a download.
                e.dataTransfer.setData(
                  'application/x-wisp-track-ids',
                  JSON.stringify(ids.map((x) => x.id)),
                )
              }}
              className={[
                // The `group` class drives the hover-only action visibility below.
                'group absolute left-0 right-0 grid border-b border-[var(--color-border)]/40',
                onSelect ? 'cursor-pointer' : '',
                isHighlighted
                  ? 'bg-[var(--color-accent)]/15 ring-1 ring-inset ring-[var(--color-accent)]/40'
                  : 'hover:bg-white/5',
              ].join(' ')}
              style={{
                transform: `translateY(${vRow.start}px)`,
                height: ROW_HEIGHT,
                gridTemplateColumns: gridTemplate,
              }}
            >
              <VisibleCells visible={prefs.visible}>
                {/* One child per canonical column; visibility changes never replace the scroll owner. */}
                <div
                  className={[
                    'flex items-center justify-center gap-1 transition-opacity',
                    isHighlighted
                      ? 'opacity-100'
                      : 'opacity-70 group-hover:opacity-100 group-focus-within:opacity-100',
                  ].join(' ')}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      playTrack(t.id)
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted)] hover:bg-[var(--color-accent)] hover:text-white"
                    title="Play in mini-player"
                    aria-label="Play"
                  >
                    <Play size={11} fill="currentColor" />
                  </button>
                  {onAddToChain ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddToChain(t.id)
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-muted)] hover:bg-[var(--color-accent)] hover:text-white"
                      title="Add to active mix plan"
                      aria-label="Add to active mix plan"
                    >
                      <Plus size={12} strokeWidth={2} />
                    </button>
                  ) : (
                    <span
                      className="text-[var(--color-muted)]/30"
                      title="Create or select a mix plan to add tracks"
                    >
                      <Plus size={12} strokeWidth={2} />
                    </span>
                  )}
                </div>

                {/* Cleanup flag — always visible when applicable, doesn't compete with hover actions. */}
                <div className="flex items-center justify-center">
                  {t.isUnavailable && (
                    <span
                      className="text-amber-300"
                      title="File missing — right-click to relink"
                      aria-label="File missing"
                    >
                      <AlertTriangle size={13} />
                    </span>
                  )}
                  {!t.isUnavailable && (t.isDirtyName || t.isMissingMetadata) && onCleanup && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onCleanup(t)
                      }}
                      className="text-amber-400 hover:text-amber-300"
                      title={
                        t.isDirtyName && t.isMissingMetadata
                          ? 'Dirty filename and missing metadata — cleanup suggested'
                          : t.isDirtyName
                            ? 'Dirty filename — cleanup suggested'
                            : 'Missing metadata — cleanup suggested'
                      }
                      aria-label="Open cleanup preview"
                    >
                      <AlertTriangle size={13} strokeWidth={1.75} />
                    </button>
                  )}
                </div>

                <Cell value={t.artist} muted={!t.artist} />
                <div className="flex min-w-0 items-center">
                  <div className="min-w-0 flex-1">
                    <Cell value={t.title} muted={!t.title} />
                  </div>
                  {t.hasNormalizedVersion && !prefs.visible.includes('fileName') && (
                    <span className="mr-2 shrink-0 rounded border border-[var(--color-accent)]/40 px-1 text-[10px] text-[var(--color-accent)]">
                      {t.audioVersion === 'normalized' ? 'Normalised' : 'Original · copy saved'}
                    </span>
                  )}
                </div>
                <Cell value={t.version} muted={!t.version} />
                <PillCell align="right">
                  <BpmPill bpm={t.bpm} />
                </PillCell>
                <PillCell>
                  <KeyPill musicalKey={t.musicalKey} />
                </PillCell>
                <PillCell>
                  <EnergyPill energy={t.energy} />
                </PillCell>
                <Cell value={t.genre} muted tertiary />
                <Cell value={formatDuration(t.durationSeconds)} align="right" muted />
                <Cell value={formatTrackDate(t.addedAt)} muted />
                <Cell value={formatTrackDate(t.fileModifiedAt)} muted />
                <div
                  className="flex min-w-0 items-center gap-2 px-3 text-sm text-[var(--color-muted)]/70"
                  title={t.filePath}
                >
                  {t.hasNormalizedVersion && (
                    <span className="shrink-0 rounded border border-[var(--color-accent)]/40 px-1 text-[10px] text-[var(--color-accent)]">
                      {t.audioVersion === 'normalized' ? 'Normalised' : 'Original · copy saved'}
                    </span>
                  )}
                  <span className="truncate">{t.fileName}</span>
                </div>
              </VisibleCells>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VisibleCells({ visible, children }: { visible: LibraryColumnKey[]; children: ReactNode }) {
  return Children.toArray(children).flatMap((child, index) =>
    visible.includes(libraryColumns[index].key)
      ? [
          <div key={libraryColumns[index].key} role="cell" className="contents">
            {child}
          </div>,
        ]
      : [],
  )
}

function Cell({
  value,
  align,
  muted,
  truncate,
  tertiary,
}: {
  value: string | number | null
  align?: 'right'
  muted?: boolean
  truncate?: boolean
  tertiary?: boolean
}) {
  return (
    <div
      className={[
        'flex items-center px-3 text-sm',
        align === 'right' ? 'justify-end' : '',
        // tertiary = even softer than muted (file path / genre / duration — supporting info, not data).
        tertiary ? 'text-[var(--color-muted)]/70' : muted ? 'text-[var(--color-muted)]' : '',
        truncate ? 'truncate' : 'truncate',
      ].join(' ')}
      title={value === null || value === undefined ? '' : String(value)}
    >
      {value ?? '—'}
    </div>
  )
}

function PillCell({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <div className={`flex items-center px-3 ${align === 'right' ? 'justify-end' : ''}`}>
      {children}
    </div>
  )
}
