import { useEffect } from 'react'
import type { Track } from '../../api/types'
import { useAudioDeck } from '../../audio/useAudioDeck'
import { useCrossfader } from '../../audio/useCrossfader'
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

  // Stop both decks when the dialog closes.
  useEffect(() => {
    return () => {
      deckA.pause()
      deckB.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ESC closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
          Press play on each deck independently. Drag the crossfader to blend. Click on a waveform to seek.
        </p>
      </div>
    </div>
  )
}
