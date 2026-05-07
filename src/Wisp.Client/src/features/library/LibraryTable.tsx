import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Track } from '../../api/types'
import { formatBpm, formatDuration } from './format'

interface Props {
  tracks: Track[]
  loading: boolean
  selectedId?: string | null
  onSelect?: (track: Track) => void
  onAddToChain?: (trackId: string) => void
  onCleanup?: (track: Track) => void
}

const columns: { key: keyof Track | 'duration' | 'add' | 'flags'; label: string; width: string; align?: 'right' }[] = [
  { key: 'add', label: '', width: '2.5rem' },
  { key: 'flags', label: '', width: '2.5rem' },
  { key: 'artist', label: 'Artist', width: '14rem' },
  { key: 'title', label: 'Title', width: '18rem' },
  { key: 'version', label: 'Version', width: '10rem' },
  { key: 'bpm', label: 'BPM', width: '4.5rem', align: 'right' },
  { key: 'musicalKey', label: 'Key', width: '4rem' },
  { key: 'energy', label: 'Energy', width: '4.5rem', align: 'right' },
  { key: 'genre', label: 'Genre', width: '8rem' },
  { key: 'duration', label: 'Duration', width: '5rem', align: 'right' },
  { key: 'fileName', label: 'File', width: '20rem' },
]

const ROW_HEIGHT = 36

export function LibraryTable({ tracks, loading, selectedId, onSelect, onAddToChain, onCleanup }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)

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

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div className="sticky top-0 z-10 grid border-b border-[var(--color-border)] bg-[var(--color-surface)] text-xs uppercase tracking-wide text-[var(--color-muted)]"
        style={{ gridTemplateColumns: columns.map((c) => c.width).join(' ') }}>
        {columns.map((c) => (
          <div key={c.key as string}
               className={`px-3 py-2 ${c.align === 'right' ? 'text-right' : ''}`}>
            {c.label}
          </div>
        ))}
      </div>

      <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
        {virt.getVirtualItems().map((vRow) => {
          const t = tracks[vRow.index]
          const isSelected = selectedId === t.id
          return (
            <div
              key={t.id}
              role={onSelect ? 'button' : undefined}
              onClick={() => onSelect?.(t)}
              className={[
                'absolute left-0 right-0 grid border-b border-[var(--color-border)]/40',
                onSelect ? 'cursor-pointer' : '',
                isSelected ? 'bg-[var(--color-accent)]/15' : 'hover:bg-white/5',
              ].join(' ')}
              style={{
                transform: `translateY(${vRow.start}px)`,
                height: ROW_HEIGHT,
                gridTemplateColumns: columns.map((c) => c.width).join(' '),
              }}
            >
              <div className="flex items-center justify-center">
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
                    className="text-[var(--color-muted)]/40"
                    title="Create or select a mix plan to add tracks"
                  >
                    +
                  </span>
                )}
              </div>
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
              <Cell value={formatBpm(t.bpm)} align="right" />
              <Cell value={t.musicalKey} muted={!t.musicalKey} />
              <Cell value={t.energy?.toString() ?? '—'} align="right" muted={t.energy === null} />
              <Cell value={t.genre} muted={!t.genre} />
              <Cell value={formatDuration(t.durationSeconds)} align="right" />
              <Cell value={t.fileName} truncate />
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
}: {
  value: string | number | null
  align?: 'right'
  muted?: boolean
  truncate?: boolean
}) {
  return (
    <div
      className={[
        'flex items-center px-3 text-sm',
        align === 'right' ? 'justify-end' : '',
        muted ? 'text-[var(--color-muted)]' : '',
        truncate ? 'truncate' : 'truncate',
      ].join(' ')}
      title={value === null || value === undefined ? '' : String(value)}
    >
      {value ?? '—'}
    </div>
  )
}
