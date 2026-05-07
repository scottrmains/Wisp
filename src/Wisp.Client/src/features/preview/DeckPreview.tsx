import type { Track } from '../../api/types'
import type { AudioDeck } from '../../audio/useAudioDeck'
import { formatDuration } from '../library/format'
import { WaveformView } from './WaveformView'

interface Props {
  label: string
  track: Track
  deck: AudioDeck
}

export function DeckPreview({ label, track, deck }: Props) {
  return (
    <section className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Deck {label}</p>
          <h3 className="truncate text-sm font-semibold">{track.title ?? track.fileName}</h3>
          <p className="truncate text-xs text-[var(--color-muted)]">
            {track.artist ?? 'Unknown'}
            {track.bpm !== null && ` · ${track.bpm} BPM`}
            {track.musicalKey !== null && ` · ${track.musicalKey}`}
            {track.energy !== null && ` · E${track.energy}`}
          </p>
        </div>
        {deck.error && <span className="text-xs text-red-400">{deck.error}</span>}
      </header>

      <WaveformView
        trackId={track.id}
        duration={deck.duration}
        currentTime={deck.currentTime}
        onSeek={deck.seek}
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={() => void deck.toggle()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-white"
          aria-label={deck.isPlaying ? 'Pause' : 'Play'}
        >
          {deck.isPlaying ? (
            <span className="text-base">❚❚</span>
          ) : (
            <span className="ml-0.5 text-base">▶</span>
          )}
        </button>

        <span className="w-20 shrink-0 text-xs tabular-nums text-[var(--color-muted)]">
          {formatDuration(deck.currentTime)} / {formatDuration(deck.duration)}
        </span>

        <input
          type="range"
          min={0}
          max={Math.max(0.01, deck.duration)}
          step={0.1}
          value={deck.currentTime}
          onChange={(e) => deck.seek(Number(e.target.value))}
          className="flex-1 accent-[var(--color-accent)]"
        />

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs text-[var(--color-muted)]">vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={deck.volume}
            onChange={(e) => deck.setVolume(Number(e.target.value))}
            className="w-20 accent-[var(--color-accent)]"
          />
        </div>
      </div>
    </section>
  )
}
