import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tracks } from '../../api/library'
import type { RecommendationMode, Track } from '../../api/types'
import { formatBpm } from './format'

interface Props {
  seed: Track
  onClose: () => void
}

const MODES: { value: RecommendationMode; label: string }[] = [
  { value: 'Safe', label: 'Safe' },
  { value: 'EnergyUp', label: 'Energy ↑' },
  { value: 'EnergyDown', label: 'Energy ↓' },
  { value: 'SameVibe', label: 'Same vibe' },
  { value: 'Creative', label: 'Creative' },
  { value: 'Wildcard', label: 'Wildcard' },
]

export function RecommendationPanel({ seed, onClose }: Props) {
  const [mode, setMode] = useState<RecommendationMode>('Safe')

  const recsQuery = useQuery({
    queryKey: ['recommendations', seed.id, mode],
    queryFn: () => tracks.recommendations(seed.id, mode),
  })

  return (
    <aside className="flex h-full w-[28rem] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)]">
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Seed track</p>
          <h2 className="mt-1 truncate text-base font-semibold">{seed.title ?? seed.fileName}</h2>
          <p className="truncate text-sm text-[var(--color-muted)]">
            {seed.artist ?? 'Unknown artist'}
            {seed.bpm !== null && ` · ${formatBpm(seed.bpm)} BPM`}
            {seed.musicalKey !== null && ` · ${seed.musicalKey}`}
            {seed.energy !== null && ` · E${seed.energy}`}
          </p>
        </div>
        <button onClick={onClose} className="text-xl leading-none text-[var(--color-muted)] hover:text-white">
          ×
        </button>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] px-5 py-3">
        {MODES.map((m) => (
          <button
            key={m.value}
            onClick={() => setMode(m.value)}
            className={[
              'rounded-full px-3 py-1 text-xs',
              mode === m.value
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-bg)] text-[var(--color-muted)] hover:text-white',
            ].join(' ')}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {recsQuery.isLoading && (
          <p className="px-5 py-6 text-sm text-[var(--color-muted)]">Scoring candidates…</p>
        )}
        {recsQuery.error && (
          <p className="px-5 py-6 text-sm text-red-400">{(recsQuery.error as Error).message}</p>
        )}
        {recsQuery.data && recsQuery.data.length === 0 && (
          <p className="px-5 py-6 text-sm text-[var(--color-muted)]">
            No compatible tracks found. Make sure your library has tracks with BPM and key tags.
          </p>
        )}
        {recsQuery.data?.map((r) => <RecommendationRow key={r.track.id} rec={r} />)}
      </div>
    </aside>
  )
}

function RecommendationRow({ rec }: { rec: import('../../api/types').Recommendation }) {
  const [open, setOpen] = useState(false)
  const t = rec.track

  return (
    <div className="border-b border-[var(--color-border)]/40 px-5 py-3">
      <div className="flex items-center gap-3">
        <ScoreBadge value={rec.total} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{t.title ?? t.fileName}</p>
          <p className="truncate text-xs text-[var(--color-muted)]">
            {t.artist ?? 'Unknown'}
            {t.bpm !== null && ` · ${formatBpm(t.bpm)}`}
            {t.musicalKey !== null && ` · ${t.musicalKey}`}
            {t.energy !== null && ` · E${t.energy}`}
          </p>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          className="text-xs text-[var(--color-muted)] hover:text-white"
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Why?'}
        </button>
      </div>
      {open && (
        <div className="mt-2 ml-12 flex flex-wrap gap-1.5">
          {rec.reasons.map((r) => (
            <span
              key={r}
              className="rounded bg-[var(--color-bg)] px-2 py-0.5 text-xs text-[var(--color-muted)]"
            >
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ScoreBadge({ value }: { value: number }) {
  // 60+ strong, 40+ ok, less weak
  const tone =
    value >= 60
      ? 'bg-emerald-500/20 text-emerald-300'
      : value >= 40
        ? 'bg-amber-500/20 text-amber-300'
        : 'bg-white/10 text-[var(--color-muted)]'
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${tone}`}>
      {value}
    </span>
  )
}
