import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { blendRatings } from '../../api/blendRatings'
import type { BlendRatingValue, Track } from '../../api/types'
import { useAudioDeck } from '../../audio/useAudioDeck'
import { useCrossfader } from '../../audio/useCrossfader'
import { useCues } from '../cues/useCues'
import { Crossfader } from './Crossfader'
import { DeckPreview } from './DeckPreview'

interface Props {
  trackA: Track
  trackB: Track
  onClose: () => void
}

export function PreviewDialog({ trackA, trackB, onClose }: Props) {
  const deckA = useAudioDeck(trackA.id)
  const deckB = useAudioDeck(trackB.id)
  const [fade, setFade] = useCrossfader(deckA.gainNode, deckB.gainNode)

  const cuesA = useCues(trackA.id).cues
  const cuesB = useCues(trackB.id).cues

  // Cleanup decks on close.
  useEffect(() => {
    return () => {
      deckA.pause()
      deckB.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ESC closes; 1-8 jumps deck A; Shift+1-8 jumps deck B.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > 8) return
      const cues = e.shiftKey ? cuesB : cuesA
      const deck = e.shiftKey ? deckB : deckA
      const cue = cues[n - 1]
      if (cue) {
        deck.seek(cue.timeSeconds)
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, cuesA, cuesB, deckA, deckB])

  // Active deck = the one currently audible. While the crossfader is mid-way we treat
  // both as active (highlight both decks); past 0.66 / 0.34 we lock to one side.
  const aHot = fade < 0.66
  const bHot = fade > 0.34

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-2xl">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Blend preview</h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-[var(--color-muted)] hover:text-white"
            aria-label="Close preview"
          >
            ×
          </button>
        </header>

        <DeckShell active={aHot} side="A">
          <DeckPreview label="A" track={trackA} deck={deckA} />
        </DeckShell>

        <CenterStrip
          fade={fade}
          onFadeChange={setFade}
          trackA={trackA}
          trackB={trackB}
          deckA={deckA}
          deckB={deckB}
        />

        <DeckShell active={bHot} side="B">
          <DeckPreview label="B" track={trackB} deck={deckB} />
        </DeckShell>

        <BlendRatingRow trackAId={trackA.id} trackBId={trackB.id} />

        <p className="text-center text-[11px] text-[var(--color-muted)]">
          Click waveform to seek · drag crossfader to blend · keys <kbd>1</kbd>–<kbd>8</kbd> jump Deck A cues, <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>8</kbd> jump Deck B
        </p>
      </div>
    </div>
  )
}

function DeckShell({
  active,
  side,
  children,
}: {
  active: boolean
  side: 'A' | 'B'
  children: React.ReactNode
}) {
  return (
    <div
      className={[
        'rounded-md border p-2 transition-colors',
        active
          ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/5'
          : 'border-[var(--color-border)] bg-[var(--color-surface)]',
      ].join(' ')}
      data-deck={side}
    >
      {children}
    </div>
  )
}

function CenterStrip({
  fade,
  onFadeChange,
  trackA,
  trackB,
  deckA,
  deckB,
}: {
  fade: number
  onFadeChange: (n: number) => void
  trackA: Track
  trackB: Track
  deckA: ReturnType<typeof useAudioDeck>
  deckB: ReturnType<typeof useAudioDeck>
}) {
  // Overlap = remaining time on A vs how far into B we are. A useful proxy for
  // "how long the blend will run for" without tracking explicit cue points.
  const overlap = useMemo(() => {
    const aRemaining = Math.max(0, deckA.duration - deckA.currentTime)
    const bRemaining = Math.max(0, deckB.duration - deckB.currentTime)
    const o = Math.min(aRemaining, deckB.currentTime)
    return Number.isFinite(o) && o > 0 ? o : Math.min(aRemaining, bRemaining, 32)
  }, [deckA.currentTime, deckA.duration, deckB.currentTime, deckB.duration])

  // Bars at avg BPM — a beat is 60/bpm; 4-beat bar is 240/bpm seconds.
  const avgBpm = useMemo(() => {
    if (trackA.bpm !== null && trackB.bpm !== null) return (Number(trackA.bpm) + Number(trackB.bpm)) / 2
    return Number(trackA.bpm ?? trackB.bpm ?? 0)
  }, [trackA.bpm, trackB.bpm])
  const barsForOverlap = avgBpm > 0 ? Math.round((overlap / (240 / avgBpm))) : null

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2">
      <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--color-muted)]">
        <span>Crossfader</span>
        <span>
          Overlap: {overlap.toFixed(1)}s
          {barsForOverlap !== null && ` (~${barsForOverlap} bars at ${avgBpm.toFixed(0)} BPM)`}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Crossfader fade={fade} onChange={onFadeChange} />
        </div>
        <SyncButton trackA={trackA} trackB={trackB} deckB={deckB} />
      </div>
    </div>
  )
}

function BlendRatingRow({ trackAId, trackBId }: { trackAId: string; trackBId: string }) {
  const qc = useQueryClient()
  const ratingQuery = useQuery({
    queryKey: ['blendRating', trackAId, trackBId],
    queryFn: () => blendRatings.getForPair(trackAId, trackBId),
    staleTime: 10_000,
  })
  const upsert = useMutation({
    mutationFn: (rating: BlendRatingValue) => blendRatings.upsert({ trackAId, trackBId, rating }),
    onSuccess: (saved) => qc.setQueryData(['blendRating', trackAId, trackBId], saved),
  })

  const current = ratingQuery.data?.rating ?? null

  return (
    <div className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
      <span className="text-xs text-[var(--color-muted)]">Rate this blend</span>
      <div className="flex items-center gap-1">
        <RatingButton emoji="🔥" label="Great" value="Great" current={current} onClick={(v) => upsert.mutate(v)} />
        <RatingButton emoji="👍" label="Good" value="Good" current={current} onClick={(v) => upsert.mutate(v)} />
        <RatingButton emoji="😐" label="Maybe" value="Maybe" current={current} onClick={(v) => upsert.mutate(v)} />
        <RatingButton emoji="❌" label="Bad" value="Bad" current={current} onClick={(v) => upsert.mutate(v)} />
      </div>
      {upsert.isError && <span className="ml-2 text-[11px] text-red-400">save failed</span>}
    </div>
  )
}

function RatingButton({
  emoji,
  label,
  value,
  current,
  onClick,
}: {
  emoji: string
  label: string
  value: BlendRatingValue
  current: BlendRatingValue | null
  onClick: (v: BlendRatingValue) => void
}) {
  const active = current === value
  return (
    <button
      onClick={() => onClick(value)}
      className={[
        'flex items-center gap-1 rounded-md px-2 py-1 text-xs',
        active
          ? 'bg-[var(--color-accent)] text-white'
          : 'bg-[var(--color-bg)] text-[var(--color-muted)] hover:bg-white/5 hover:text-white',
      ].join(' ')}
      title={`Mark as ${label}`}
    >
      <span aria-hidden>{emoji}</span>
      <span>{label}</span>
    </button>
  )
}

function SyncButton({
  trackA,
  trackB,
  deckB,
}: {
  trackA: Track
  trackB: Track
  deckB: ReturnType<typeof useAudioDeck>
}) {
  const canSync = trackA.bpm !== null && trackB.bpm !== null && trackB.bpm > 0
  const ratio = canSync ? Number(trackA.bpm) / Number(trackB.bpm) : 1
  const inRange = ratio >= 0.9 && ratio <= 1.1

  const handleSync = () => {
    if (!canSync || !inRange) return
    deckB.setTempo(ratio)
  }

  const title = !canSync
    ? 'Both tracks need a BPM tag to sync'
    : !inRange
      ? `BPM ratio ${ratio.toFixed(3)} is outside ±10% — too aggressive a stretch for clean audio`
      : `Match Deck B to Deck A's tempo (${(ratio * 100).toFixed(1)}%)`

  return (
    <button
      onClick={handleSync}
      disabled={!canSync || !inRange}
      title={title}
      className="shrink-0 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15 px-3 py-2 text-xs font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent)]/25 disabled:cursor-not-allowed disabled:border-[var(--color-border)] disabled:bg-transparent disabled:text-[var(--color-muted)]"
    >
      Sync B → A
    </button>
  )
}
