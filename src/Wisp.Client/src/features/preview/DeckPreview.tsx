import type { Track } from '../../api/types'
import type { AudioDeck } from '../../audio/useAudioDeck'
import { CuePointEditor } from '../cues/CuePointEditor'
import { useCues } from '../cues/useCues'
import { formatDuration } from '../library/format'
import { WaveformView } from './WaveformView'

interface Props {
  label: string
  track: Track
  deck: AudioDeck
}

export function DeckPreview({ label, track, deck }: Props) {
  const { cues } = useCues(track.id)
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
        cues={cues}
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

      <TempoRow track={track} deck={deck} />

      <CuePointEditor
        trackId={track.id}
        hasBpm={track.bpm !== null}
        currentTime={deck.currentTime}
        onSeek={deck.seek}
      />
    </section>
  )
}

function TempoRow({ track, deck }: { track: Track; deck: AudioDeck }) {
  const pct = (deck.tempo - 1) * 100
  const effectiveBpm = track.bpm !== null ? track.bpm * deck.tempo : null

  return (
    <div className="mt-2 flex items-center gap-3 rounded-md border border-[var(--color-border)]/60 bg-[var(--color-bg)] px-3 py-2">
      <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Tempo</span>

      <input
        type="range"
        min={-10}
        max={10}
        step={0.1}
        value={pct}
        onChange={(e) => deck.setTempo(1 + Number(e.target.value) / 100)}
        onDoubleClick={deck.resetTempo}
        className="flex-1 accent-[var(--color-accent)]"
        title="Drag to change tempo · double-click to reset"
        aria-label="Tempo"
      />

      <span className="w-14 shrink-0 text-right text-xs tabular-nums text-[var(--color-muted)]">
        {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
      </span>

      {effectiveBpm !== null && (
        <span className="w-20 shrink-0 text-right text-xs tabular-nums">
          {effectiveBpm.toFixed(1)} BPM
        </span>
      )}

      <button
        onClick={() => deck.setTempoMode(deck.tempoMode === 'masterTempo' ? 'pitch' : 'masterTempo')}
        className={[
          'rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
          deck.tempoMode === 'masterTempo'
            ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
            : 'border-[var(--color-border)] text-[var(--color-muted)]',
        ].join(' ')}
        title={
          deck.tempoMode === 'masterTempo'
            ? 'Master tempo — pitch is preserved when tempo changes'
            : 'Pitch mode — tempo and pitch shift together (vinyl-style)'
        }
      >
        {deck.tempoMode === 'masterTempo' ? 'Master' : 'Pitch'}
      </button>

      <button
        onClick={deck.resetTempo}
        disabled={deck.tempo === 1}
        className="text-xs text-[var(--color-muted)] hover:text-white disabled:opacity-30"
        title="Reset tempo to 1.0"
      >
        Reset
      </button>
    </div>
  )
}
