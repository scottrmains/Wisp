import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { tracks as tracksApi } from '../../api/library'
import type { ArchiveReason, Track } from '../../api/types'

interface Props {
  /// Single-track mode — header shows the track name.
  track?: Track
  /// Bulk mode — header shows "Retire N tracks?". Either this or `track` is required.
  trackIds?: string[]
  onClose: () => void
  /// Single-mode hook (existing callers). For bulk, prefer `onArchivedBulk`.
  onArchived?: (track: Track) => void
  onArchivedBulk?: (count: number) => void
}

const REASONS: { value: ArchiveReason; label: string }[] = [
  { value: 'Outdated', label: 'Outdated' },
  { value: 'LowQuality', label: 'Low quality' },
  { value: 'Duplicate', label: 'Duplicate' },
  { value: 'BadMetadata', label: 'Bad metadata' },
  { value: 'NotMyVibe', label: 'Not my vibe' },
  { value: 'KeepForMemory', label: 'Keep for memory' },
  { value: 'Other', label: 'Other' },
]

/// Soft-archive prompt. Source file on disk is never moved or deleted —
/// the track is simply hidden from default views and the recommender pool.
/// Supports single-track mode (`track` prop) and bulk mode (`trackIds` prop).
export function ArchiveModal({ track, trackIds, onClose, onArchived, onArchivedBulk }: Props) {
  const qc = useQueryClient()
  const [reason, setReason] = useState<ArchiveReason>('NotMyVibe')
  const ids = track ? [track.id] : (trackIds ?? [])
  const isBulk = !track

  const archive = useMutation({
    mutationFn: async () => {
      // Sequential for SQLite friendliness; selection sizes are bounded by manual click.
      const results = []
      for (const id of ids) {
        results.push(await tracksApi.archive(id, reason))
      }
      return results
    },
    onSuccess: (updated) => {
      for (const t of updated) qc.setQueryData(['track', t.id], t)
      qc.invalidateQueries({ queryKey: ['tracks'] })
      if (track && updated[0]) onArchived?.(updated[0])
      if (isBulk) onArchivedBulk?.(updated.length)
      onClose()
    },
  })

  const label = track
    ? `${track.artist ?? 'Unknown'} — ${track.title ?? track.fileName}`
    : `${ids.length} tracks`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
         onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-2xl">
        <h2 className="text-base font-semibold">
          {isBulk ? `Retire ${ids.length} tracks from your active library?` : 'Retire this track from your active library?'}
        </h2>
        <p className="mt-1 truncate text-sm text-[var(--color-muted)]" title={label}>{label}</p>

        <p className="mt-3 text-[11px] uppercase tracking-wide text-[var(--color-muted)]">Reason</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button
              key={r.value}
              onClick={() => setReason(r.value)}
              className={[
                'rounded-md border px-2.5 py-1 text-xs',
                reason === r.value
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/20 text-white'
                  : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-white',
              ].join(' ')}
            >
              {r.label}
            </button>
          ))}
        </div>

        <p className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 text-[11px] text-[var(--color-muted)]">
          The file on disk stays exactly where it is — Wisp just hides this track from the
          library + recommendations until you restore it.
        </p>

        {archive.isError && (
          <p className="mt-2 text-xs text-red-400">{(archive.error as Error).message}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={() => archive.mutate()}
            disabled={archive.isPending}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {archive.isPending ? 'Archiving…' : isBulk ? `Archive ${ids.length}` : 'Archive'}
          </button>
        </div>
      </div>
    </div>
  )
}
