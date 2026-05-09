import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tracks } from '../../api/library'
import { playlists as playlistsApi } from '../../api/playlists'
import type { Recommendation, RecommendationMode, Track } from '../../api/types'
import { useActivePlan } from '../../state/activePlan'
import { usePlayer } from '../../state/player'
import { useMixPlan } from '../mixchain/useMixPlans'
import { formatBpm } from './format'

const MODES: { value: RecommendationMode; label: string }[] = [
  { value: 'Safe', label: 'Safe' },
  { value: 'EnergyUp', label: 'Energy ↑' },
  { value: 'EnergyDown', label: 'Energy ↓' },
  { value: 'SameVibe', label: 'Same vibe' },
  { value: 'Creative', label: 'Creative' },
  { value: 'Wildcard', label: 'Wildcard' },
  { value: 'Party', label: '🪩 Party' },
]

interface RecommendationsListProps {
  seed: Track
  onAddToChain?: (trackId: string) => void
}

/// Mode pills + recommendation rows, no surrounding panel chrome. Used inside the
/// inspector's Recommendations tab.
///
/// Recommendation scoping (Phase 21d): when the user has an active mix plan AND
/// that plan has a `recommendationScopePlaylistId` set, the candidate pool is
/// transparently restricted to playlist members. We surface a chip so the user
/// can see why they're getting fewer results than expected.
export function RecommendationsList({ seed, onAddToChain }: RecommendationsListProps) {
  const [mode, setMode] = useState<RecommendationMode>('Safe')
  const { activePlanId } = useActivePlan()
  const { plan: activePlan } = useMixPlan(activePlanId)
  const scopePlaylistId = activePlan?.recommendationScopePlaylistId ?? null

  const playlistList = useQuery({
    queryKey: ['playlists'],
    queryFn: () => playlistsApi.list(),
    staleTime: 30_000,
    enabled: scopePlaylistId !== null,
  })
  const scopePlaylist = playlistList.data?.find((p) => p.id === scopePlaylistId) ?? null

  const recsQuery = useQuery({
    queryKey: ['recommendations', seed.id, mode, scopePlaylistId],
    queryFn: () => tracks.recommendations(seed.id, {
      mode,
      scopePlaylistId: scopePlaylistId ?? undefined,
    }),
  })

  return (
    <div className="flex h-full min-h-0 flex-col">
      {scopePlaylist && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-accent)]/5 px-5 py-1.5 text-[11px]">
          <span className="text-[var(--color-muted)]">Scoped to:</span>
          <span className="font-medium text-white">{scopePlaylist.name}</span>
          <span className="text-[var(--color-muted)] tabular-nums">
            ({scopePlaylist.trackCount} {scopePlaylist.trackCount === 1 ? 'track' : 'tracks'})
          </span>
          <span className="ml-auto text-[var(--color-muted)]" title="Set by the active mix plan; clear it from the plan header.">
            via active plan
          </span>
        </div>
      )}
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
        {recsQuery.data?.map((r) => (
          <RecommendationRow key={r.track.id} seed={seed} rec={r} onAddToChain={onAddToChain} />
        ))}
      </div>
    </div>
  )
}

interface PanelProps {
  seed: Track
  onClose: () => void
  onAddToChain?: (trackId: string) => void
}

/// Standalone version with header + close button. Kept for any legacy caller.
export function RecommendationPanel({ seed, onClose, onAddToChain }: PanelProps) {
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
      <RecommendationsList seed={seed} onAddToChain={onAddToChain} />
    </aside>
  )
}

function RecommendationRow({
  seed,
  rec,
  onAddToChain,
}: {
  seed: Track
  rec: Recommendation
  onAddToChain?: (trackId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const t = rec.track
  const playTrack = usePlayer((s) => s.playTrack)
  const playerTrackId = usePlayer((s) => s.trackId)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const togglePlay = usePlayer((s) => s.togglePlay)

  // The same row is "now playing" when its track id matches the player's.
  const isLoaded = playerTrackId === t.id

  // Pick the strongest one-line reason. Backend reasons[] is already ordered by
  // weight; if it's empty (rare), synthesise from the highest-scoring axis.
  const headlineReason = rec.reasons[0] ?? deriveHeadline(seed, rec)

  // Drag-and-drop: recommendation rows produce the same wisp-track-ids payload
  // that library rows do, so the existing ChainDock + MixPlansPage drop targets
  // pick them up without changes. Lets the user drag a recommendation directly
  // onto their chain instead of having to click the +.
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'copyMove'
    e.dataTransfer.setData('application/x-wisp-track-ids', JSON.stringify([t.id]))
  }

  // Click the row body (title / artist / pill area) to load the rec into the
  // mini-player and start playback. This makes "audition this candidate"
  // a single click instead of forcing the user to drag onto the chain or
  // navigate away. Buttons inside the row stopPropagation so they keep
  // their distinct affordances (Add / Why?).
  const handlePlayClick = (e: React.MouseEvent) => {
    // Native drag uses mousedown; a quick click fires onClick AFTER
    // mousedown without starting a drag, which is exactly what we want.
    // No special handling needed.
    e.stopPropagation()
    if (isLoaded) {
      togglePlay()
    } else {
      playTrack(t.id)
    }
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="cursor-grab border-b border-[var(--color-border)]/40 px-5 py-3 hover:bg-white/5 active:cursor-grabbing"
      title="Click to play · drag to a mix plan / playlist"
    >
      <div className="flex items-start gap-3">
        <ScoreBadge value={rec.total} />
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handlePlayClick}
          className={[
            'min-w-0 flex-1 cursor-pointer text-left',
            // No visual styling beyond a hover lift on the title — the row
            // itself already has hover bg.
          ].join(' ')}
          title={isLoaded
            ? (isPlaying ? 'Pause' : 'Resume')
            : 'Play this recommendation'}
        >
          <p className="truncate text-sm font-medium" title={t.title ?? ''}>
            {isLoaded && (
              <span
                className="mr-1 text-[var(--color-accent)]"
                aria-hidden
              >{isPlaying ? '❚❚' : '▶'}</span>
            )}
            {t.title ?? t.fileName}
          </p>
          <p className="truncate text-xs text-[var(--color-muted)]" title={t.artist ?? ''}>
            {t.artist ?? 'Unknown'}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Pill>{formatBpm(t.bpm)} BPM</Pill>
            <Pill>{t.musicalKey ?? '—'}</Pill>
            <Pill>E{t.energy ?? '—'}</Pill>
          </div>
          <p className="mt-1.5 truncate text-[11px] italic text-[var(--color-muted)]" title={headlineReason}>
            {headlineReason}
          </p>
          {rec.previousRating && (
            <p className="mt-0.5 text-[10px] text-amber-300" title="You previously rated this transition">
              previously rated 😐 {rec.previousRating}
            </p>
          )}
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={handlePlayClick}
            className={[
              'rounded-md border px-2.5 py-1 text-xs font-medium',
              isLoaded
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white'
                : 'border-[var(--color-border)] text-[var(--color-muted)] hover:bg-white/5 hover:text-white',
            ].join(' ')}
            title={isLoaded
              ? (isPlaying ? 'Pause' : 'Resume')
              : 'Load + play in mini-player'}
          >
            {isLoaded ? (isPlaying ? '❚❚ Pause' : '▶ Resume') : '▶ Play'}
          </button>
          {onAddToChain && (
            <button
              // stopPropagation so clicking the button doesn't also start a drag
              // (some browsers begin drag from mousedown on draggable parents).
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onAddToChain(t.id)}
              className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--color-accent)]/80"
              title="Add to mix chain"
            >
              + Add
            </button>
          )}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setOpen((o) => !o)}
            className={[
              'rounded-md border px-2 py-0.5 text-[11px] transition-colors',
              open
                ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-white'
                : 'border-[var(--color-border)] text-[var(--color-muted)] hover:bg-white/5 hover:text-white',
            ].join(' ')}
            aria-expanded={open}
          >
            {open ? '▾ Why' : '▸ Why?'}
          </button>
        </div>
      </div>
      {open && <BreakdownPanel seed={seed} rec={rec} />}
    </div>
  )
}

function BreakdownPanel({ seed, rec }: { seed: Track; rec: Recommendation }) {
  const t = rec.track
  const bpmDelta = seed.bpm !== null && t.bpm !== null ? t.bpm - seed.bpm : null
  const energyDelta = seed.energy !== null && t.energy !== null ? t.energy - seed.energy : null

  return (
    <div className="mt-3 ml-12 space-y-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-2.5">
      <Axis
        label="BPM"
        score={rec.bpmScore}
        detail={
          bpmDelta === null
            ? 'unknown'
            : bpmDelta === 0
              ? 'exact match'
              : `${bpmDelta > 0 ? '+' : ''}${bpmDelta.toFixed(1)} BPM`
        }
      />
      <Axis
        label="Key"
        score={rec.keyScore}
        detail={
          !seed.musicalKey || !t.musicalKey ? 'unknown' : keyRelationLabel(seed.musicalKey, t.musicalKey)
        }
      />
      <Axis
        label="Energy"
        score={rec.energyScore}
        detail={
          energyDelta === null
            ? 'unknown'
            : energyDelta === 0
              ? 'same'
              : `${energyDelta > 0 ? '+' : ''}${energyDelta}`
        }
      />
      <Axis
        label="Genre"
        score={rec.genreScore}
        detail={!seed.genre || !t.genre ? 'unknown' : seed.genre === t.genre ? 'match' : `${t.genre}`}
      />
      {rec.penalties > 0 && (
        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-1.5 text-[11px]">
          <span className="text-amber-300">Penalties</span>
          <span className="tabular-nums text-amber-300">−{rec.penalties.toFixed(0)}</span>
        </div>
      )}
      {rec.reasons.length > 1 && (
        <div className="border-t border-[var(--color-border)] pt-1.5">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Reasons</p>
          <div className="flex flex-wrap gap-1">
            {rec.reasons.map((r) => (
              <span key={r} className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]">
                {r}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Axis({ label, score, detail }: { label: string; score: number; detail: string }) {
  // Score axes are roughly 0–100; clamp for the bar.
  const pct = Math.max(0, Math.min(100, score))
  return (
    <div className="grid grid-cols-[3.5rem_1fr_4rem_2.5rem] items-center gap-2 text-[11px]">
      <span className="text-[var(--color-muted)]">{label}</span>
      <div className="h-1.5 overflow-hidden rounded bg-[var(--color-surface)]">
        <div
          className="h-full bg-[var(--color-accent)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="truncate text-[var(--color-muted)]" title={detail}>{detail}</span>
      <span className="text-right tabular-nums">{score.toFixed(0)}</span>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-[var(--color-bg)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--color-muted)]">
      {children}
    </span>
  )
}

function ScoreBadge({ value }: { value: number }) {
  const tone =
    value >= 60
      ? 'bg-emerald-500/20 text-emerald-300'
      : value >= 40
        ? 'bg-amber-500/20 text-amber-300'
        : 'bg-white/10 text-[var(--color-muted)]'
  return (
    <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${tone}`}>
      {value}
    </span>
  )
}

/// Synthesise a one-line reason from the strongest axis when the backend
/// didn't ship any. Rare path but worth not showing a blank line.
function deriveHeadline(_seed: Track, rec: Recommendation): string {
  const axes: { label: string; score: number }[] = [
    { label: 'Same key', score: rec.keyScore },
    { label: 'Compatible BPM', score: rec.bpmScore },
    { label: 'Matched energy', score: rec.energyScore },
    { label: 'Same genre', score: rec.genreScore },
  ]
  const best = axes.sort((a, b) => b.score - a.score)[0]
  return best && best.score > 0 ? best.label : 'Compatible match'
}

/// Camelot relation summary: "same", "+1 (warm shift)", "−1 (cooler)", "relative",
/// or "clash". Falls back to a literal arrow if either key isn't a Camelot code.
function keyRelationLabel(a: string, b: string): string {
  const pa = parseCamelot(a)
  const pb = parseCamelot(b)
  if (!pa || !pb) return `${a} → ${b}`
  if (pa.n === pb.n && pa.major === pb.major) return 'same'
  if (pa.n === pb.n) return 'relative maj/min'
  const diff = pb.n - pa.n
  const wrapped = ((diff + 18) % 12) - 6 // shortest signed distance, range -5..6
  if (Math.abs(wrapped) === 1 && pa.major === pb.major) {
    return wrapped > 0 ? '+1 (energy up)' : '−1 (energy down)'
  }
  return `${a} → ${b}`
}

function parseCamelot(code: string): { n: number; major: boolean } | null {
  const m = /^(\d{1,2})([AB])$/i.exec(code.trim())
  if (!m) return null
  const n = Number(m[1])
  if (n < 1 || n > 12) return null
  return { n, major: m[2].toUpperCase() === 'B' }
}
