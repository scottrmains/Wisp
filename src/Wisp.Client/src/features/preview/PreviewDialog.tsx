import { useEffect } from 'react'
import type { Track } from '../../api/types'
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

  // Cues are also fetched inside each DeckPreview, but TanStack Query caches
  // by the same key so this doesn't cause duplicate requests.
  const cuesA = useCues(trackA.id).cues
  const cuesB = useCues(trackB.id).cues

  // Stop both decks when the dialog closes.
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
      // Skip when typing in an input/textarea — cue editor uses these.
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

        <DeckPreview label="A" track={trackA} deck={deckA} />

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Crossfader fade={fade} onChange={setFade} />
          </div>
          <SyncButton trackA={trackA} trackB={trackB} deckB={deckB} />
        </div>

        <DeckPreview label="B" track={trackB} deck={deckB} />

        <p className="text-center text-[11px] text-[var(--color-muted)]">
          Click waveform to seek · drag crossfader to blend · keys <kbd>1</kbd>–<kbd>8</kbd> jump Deck A cues, <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>8</kbd> jump Deck B
        </p>
      </div>
    </div>
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
