import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Track } from '../../api/types'
import { usePlayer } from '../../state/player'
import { formatDuration } from './format'
import { BpmPill, EnergyPill, KeyPill } from './pills'

interface Props {
  tracks: Track[]
  loading: boolean
  /// Single-row "primary" selection — drives the inspector. Subset of `selectedIds`.
  selectedId?: string | null
  /// Multi-select set. When size > 1 the inspector hides and the bulk bar shows.
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
}

interface Column {
  key: string
  label: string
  width: string
  align?: 'right'
  /// The backend sort name for this column. Omitted when the column isn't sortable.
  sortKey?: string
}

const columns: Column[] = [
  { key: 'actions', label: '', width: '5rem' },
  { key: 'flags', label: '', width: '2rem' },
  { key: 'artist', label: 'Artist', width: '14rem', sortKey: 'artist' },
  { key: 'title', label: 'Title', width: '18rem', sortKey: 'title' },
  { key: 'version', label: 'Version', width: '10rem' },
  { key: 'bpm', label: 'BPM', width: '4.5rem', align: 'right', sortKey: 'bpm' },
  { key: 'musicalKey', label: 'Key', width: '4.5rem', sortKey: 'key' },
  { key: 'energy', label: 'Energy', width: '4.5rem', sortKey: 'energy' },
  { key: 'genre', label: 'Genre', width: '8rem', sortKey: 'genre' },
  // Duration intentionally not sortable: SQLite stores TimeSpan as TEXT and can't ORDER BY
  // it without a value-converter migration. Add `sortKey: 'duration'` once the converter
  // ships in a future schema change.
  { key: 'duration', label: 'Duration', width: '5rem', align: 'right' },
  { key: 'fileName', label: 'File', width: '20rem' },
]

const ROW_HEIGHT = 36
const GRID_TEMPLATE = columns.map((c) => c.width).join(' ')

export function LibraryTable({
  tracks,
  loading,
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
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const playTrack = usePlayer((s) => s.playTrack)
  const isMultiSelected = (id: string) => selectedIds?.has(id) ?? false

  // asc → desc → off, parameterised on the column's sort key.
  const cycleSort = (sortKey: string) => {
    if (!onSortChange) return
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
        <span>No tracks match these filters.</span>
        <span className="text-xs">Clear the search box or BPM range to see your library again.</span>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div
        className="sticky top-0 z-10 grid border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs uppercase tracking-wide text-[var(--color-muted)]"
        style={{ gridTemplateColumns: GRID_TEMPLATE }}
      >
        {columns.map((c) => {
          const isActive = c.sortKey && (sort === c.sortKey || sort === `-${c.sortKey}`)
          const direction = sort === c.sortKey ? '▲' : sort === `-${c.sortKey}` ? '▼' : null
          if (!c.sortKey) {
            return (
              <div key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : ''}`}>
                {c.label}
              </div>
            )
          }
          return (
            <button
              key={c.key}
              onClick={() => cycleSort(c.sortKey!)}
              className={[
                'flex items-center gap-1 px-3 py-2 hover:text-white',
                c.align === 'right' ? 'justify-end' : '',
                isActive ? 'text-[var(--color-accent)]' : '',
              ].join(' ')}
              title={`Sort by ${c.label.toLowerCase()}${direction ? ` (currently ${direction === '▲' ? 'ascending' : 'descending'})` : ''}`}
            >
              <span>{c.label}</span>
              {direction && <span aria-hidden>{direction}</span>}
            </button>
          )
        })}
      </div>

      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((vRow) => {
          const t = tracks[vRow.index]
          const isPrimary = selectedId === t.id
          const isInSelection = isMultiSelected(t.id)
          // Either single-selected or part of a multi-selection — both get the accent treatment.
          const isHighlighted = isPrimary || isInSelection
          return (
            <div
              key={t.id}
              role={onSelect ? 'button' : undefined}
              draggable={!!onDragStartRow}
              onClick={(e) => onSelect?.(t, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })}
              onDoubleClick={() => onActivate?.(t)}
              onContextMenu={(e) => {
                if (!onContextMenu) return
                e.preventDefault()
                onContextMenu(t, e.clientX, e.clientY)
              }}
              onDragStart={(e) => {
                if (!onDragStartRow) return
                const ids = onDragStartRow(t)
                if (ids.length === 0) {
                  e.preventDefault()
                  return
                }
                e.dataTransfer.effectAllowed = 'copyMove'
                // Internal payload — used by ChainDock / MixPlansPage drop handlers.
                e.dataTransfer.setData('application/x-wisp-track-ids', JSON.stringify(ids.map((x) => x.id)))
                // External (Explorer / Rekordbox) payload — only meaningful for a single track.
                // Chromium's DownloadURL is one-file-per-drag; multi-row external drag would require
                // DataTransferItemList which is unreliable across drop targets.
                if (ids.length === 1) {
                  const only = ids[0]
                  const ext = (only.fileName.match(/\.[^./\\]+$/)?.[0] ?? '').toLowerCase()
                  const mime =
                    ext === '.mp3' ? 'audio/mpeg' :
                    ext === '.wav' ? 'audio/wav' :
                    ext === '.flac' ? 'audio/flac' :
                    ext === '.m4a' ? 'audio/mp4' :
                    ext === '.aiff' || ext === '.aif' ? 'audio/aiff' :
                    'application/octet-stream'
                  const safe = (only.artist && only.title)
                    ? `${only.artist} - ${only.title}${ext}`
                    : only.fileName
                  const safeName = safe.replace(/[\\/:*?"<>|]/g, '_')
                  const url = `${window.location.origin}/api/tracks/${only.id}/download`
                  e.dataTransfer.setData('DownloadURL', `${mime}:${safeName}:${url}`)
                  // Plain text fallback for apps that read it (like Explorer's address bar).
                  e.dataTransfer.setData('text/uri-list', url)
                }
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
                gridTemplateColumns: GRID_TEMPLATE,
              }}
            >
              {/* Actions: Play + Add to mix, both hover-only. Highlighted row keeps them visible. */}
              <div
                className={[
                  'flex items-center justify-center gap-1 transition-opacity',
                  isHighlighted ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                ].join(' ')}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    playTrack(t.id)
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded text-[11px] text-[var(--color-muted)] hover:bg-[var(--color-accent)] hover:text-white"
                  title="Play in mini-player"
                  aria-label="Play"
                >
                  ▶
                </button>
                {onAddToChain ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddToChain(t.id)
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded text-base text-[var(--color-muted)] hover:bg-[var(--color-accent)] hover:text-white"
                    title="Add to active mix plan"
                    aria-label="Add to active mix plan"
                  >
                    +
                  </button>
                ) : (
                  <span
                    className="text-[var(--color-muted)]/30"
                    title="Create or select a mix plan to add tracks"
                  >
                    +
                  </span>
                )}
              </div>

              {/* Cleanup flag — always visible when applicable, doesn't compete with hover actions. */}
              <div className="flex items-center justify-center">
                {(t.isDirtyName || t.isMissingMetadata) && onCleanup && (
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
                    ⚠
                  </button>
                )}
              </div>

              <Cell value={t.artist} muted={!t.artist} />
              <Cell value={t.title} muted={!t.title} />
              <Cell value={t.version} muted={!t.version} />
              <PillCell align="right"><BpmPill bpm={t.bpm} /></PillCell>
              <PillCell><KeyPill musicalKey={t.musicalKey} /></PillCell>
              <PillCell><EnergyPill energy={t.energy} /></PillCell>
              <Cell value={t.genre} muted tertiary />
              <Cell value={formatDuration(t.durationSeconds)} align="right" muted />
              <Cell value={t.fileName} truncate muted tertiary />
            </div>
          )
        })}
      </div>
    </div>
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
        tertiary
          ? 'text-[var(--color-muted)]/70'
          : muted
            ? 'text-[var(--color-muted)]'
            : '',
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
