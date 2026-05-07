import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cleanup } from '../../api/cleanup'
import type { AuditEntry, CleanupSuggestion, TrackSnapshot } from '../../api/types'

interface Props {
  trackId: string
  trackLabel: string
  onClose: () => void
  onApplied: (audit: AuditEntry) => void
}

export function CleanupModal({ trackId, trackLabel, onClose, onApplied }: Props) {
  const qc = useQueryClient()
  const previewQuery = useQuery({
    queryKey: ['cleanup-preview', trackId],
    queryFn: () => cleanup.preview(trackId),
  })

  const apply = useMutation({
    mutationFn: () => cleanup.apply(trackId),
    onSuccess: (audit) => {
      qc.invalidateQueries({ queryKey: ['tracks'] })
      onApplied(audit)
      onClose()
    },
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex items-start justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Cleanup preview</h2>
            <p className="truncate text-xs text-[var(--color-muted)]">{trackLabel}</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none text-[var(--color-muted)] hover:text-white">
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {previewQuery.isLoading && (
            <p className="text-sm text-[var(--color-muted)]">Computing suggestion…</p>
          )}
          {previewQuery.error && (
            <p className="text-sm text-red-400">{(previewQuery.error as Error).message}</p>
          )}
          {previewQuery.data && <Body suggestion={previewQuery.data} />}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-5 py-3">
          <p className="text-xs text-[var(--color-muted)]">
            Wisp will rewrite tags and rename the file. The change is logged and can be undone.
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={() => apply.mutate()}
              disabled={!previewQuery.data?.hasChanges || apply.isPending}
              className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {apply.isPending ? 'Applying…' : 'Apply'}
            </button>
          </div>
        </footer>
        {apply.error && (
          <div className="border-t border-red-500/30 bg-red-500/10 px-5 py-2 text-xs text-red-300">
            {(apply.error as Error).message}
          </div>
        )}
      </div>
    </div>
  )
}

function Body({ suggestion }: { suggestion: CleanupSuggestion }) {
  if (!suggestion.hasChanges) {
    return (
      <p className="text-sm text-[var(--color-muted)]">
        Nothing to clean — this track already looks tidy.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <DiffTable before={suggestion.before} after={suggestion.after} />

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Changes ({suggestion.changes.length})
        </h3>
        <ul className="space-y-1 text-xs">
          {suggestion.changes.map((c, i) => (
            <li key={i} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5">
              <span className="text-[var(--color-muted)]">{c.field}:</span>{' '}
              <span>{c.description}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function DiffTable({ before, after }: { before: TrackSnapshot; after: TrackSnapshot }) {
  const rows: { label: string; before: string; after: string }[] = [
    { label: 'File', before: before.fileName, after: after.fileName },
    { label: 'Artist', before: before.artist ?? '—', after: after.artist ?? '—' },
    { label: 'Title', before: before.title ?? '—', after: after.title ?? '—' },
    { label: 'Version', before: before.version ?? '—', after: after.version ?? '—' },
    { label: 'Album', before: before.album ?? '—', after: after.album ?? '—' },
    { label: 'Genre', before: before.genre ?? '—', after: after.genre ?? '—' },
  ]

  return (
    <div className="grid grid-cols-[5rem_1fr_1fr] gap-2 text-xs">
      <div></div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Before</div>
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">After</div>

      {rows.map((r) => {
        const changed = r.before !== r.after
        return (
          <div key={r.label} className="contents">
            <div className="py-1.5 font-medium text-[var(--color-muted)]">{r.label}</div>
            <div className="rounded bg-[var(--color-surface)] px-2 py-1.5 break-all">{r.before}</div>
            <div
              className={[
                'rounded px-2 py-1.5 break-all',
                changed
                  ? 'bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-500/30'
                  : 'bg-[var(--color-surface)]',
              ].join(' ')}
            >
              {r.after}
            </div>
          </div>
        )
      })}
    </div>
  )
}
