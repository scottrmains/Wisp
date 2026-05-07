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
        <Crossfader fade={fade} onChange={setFade} />
        <DeckPreview label="B" track={trackB} deck={deckB} />

        <p className="text-center text-[11px] text-[var(--color-muted)]">
          Click waveform to seek · drag crossfader to blend · keys <kbd>1</kbd>–<kbd>8</kbd> jump Deck A cues, <kbd>Shift</kbd>+<kbd>1</kbd>–<kbd>8</kbd> jump Deck B
        </p>
      </div>
    </div>
  )
}
