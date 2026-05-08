import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tracks as tracksApi } from '../../api/library'
import { useAudioDeck } from '../../audio/useAudioDeck'
import { usePlayer } from '../../state/player'
import { formatBpm, formatDuration } from '../library/format'
import { BandedWaveform } from './BandedWaveform'

/// Persistent bottom-bar player. Owns the single shared HTMLAudioElement /
/// Web Audio graph for ad-hoc previewing. The blend preview modal still owns
/// its own two decks — different lifecycle, different graph.
///
/// Stays mounted at the App root so playback survives navigation between
/// Library / Mix Plans / Discover / Crate Digger.
export function MiniPlayer() {
  const trackId = usePlayer((s) => s.trackId)
  const registerCommands = usePlayer((s) => s._registerCommands)
  const setStatus = usePlayer((s) => s._setStatus)
  const consumePendingPlay = usePlayer((s) => s._consumePendingPlay)
  const clear = usePlayer((s) => s.clear)

  const deck = useAudioDeck(trackId)

  const trackQuery = useQuery({
    queryKey: ['track', trackId],
    queryFn: () => tracksApi.get(trackId!),
    enabled: !!trackId,
    staleTime: 60_000,
  })
  const track = trackQuery.data

  // Publish imperative controls to the store.
  useEffect(() => {
    registerCommands({
      play: deck.play,
      pause: () => deck.pause(),
      toggle: deck.toggle,
      seek: deck.seek,
    })
    return () => registerCommands(null)
  }, [deck.play, deck.pause, deck.toggle, deck.seek, registerCommands])

  // Mirror status back to the store.
  useEffect(() => {
    setStatus({ isPlaying: deck.isPlaying, position: deck.currentTime, duration: deck.duration })
  }, [deck.isPlaying, deck.currentTime, deck.duration, setStatus])

  // Auto-start once metadata lands, if `playTrack` was the entrypoint.
  useEffect(() => {
    if (deck.duration > 0 && !deck.loading && consumePendingPlay()) {
      void deck.play()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.duration, deck.loading])

  if (!trackId) return null

  const title = track?.title ?? track?.fileName ?? '…'
  const artist = track?.artist ?? 'Unknown'

  return (
    <div className="flex shrink-0 flex-col border-t border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Waveform: full width, click to seek, MiK-style band-coloured bars. */}
      <div className="px-3 pt-2">
        <BandedWaveform
          trackId={trackId}
          duration={deck.duration}
          currentTime={deck.currentTime}
          onSeek={(t) => deck.seek(t)}
          height={80}
        />
      </div>

      {/* Controls strip below the waveform. */}
      <div className="flex h-12 items-center gap-3 px-3">
        <button
          onClick={() => void deck.toggle()}
          disabled={deck.loading}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-sm text-white disabled:opacity-40"
          aria-label={deck.isPlaying ? 'Pause' : 'Play'}
          title={deck.isPlaying ? 'Pause' : 'Play'}
        >
          {deck.loading ? '…' : deck.isPlaying ? '❚❚' : '▶'}
        </button>

        {/* Title + artist */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={title}>
            {title}
          </p>
          <p className="truncate text-xs text-[var(--color-muted)]" title={artist}>
            {artist}
          </p>
        </div>

        {/* Time */}
        <div className="shrink-0 tabular-nums text-xs text-[var(--color-muted)]">
          {formatDuration(deck.currentTime)} / {formatDuration(deck.duration)}
        </div>

        {/* Metadata pills */}
        {track && (
          <div className="hidden shrink-0 items-center gap-1.5 md:flex">
            <Pill>{formatBpm(track.bpm)} BPM</Pill>
            <Pill>{track.musicalKey ?? '—'}</Pill>
            <Pill>E{track.energy ?? '—'}</Pill>
          </div>
        )}

        <button
          onClick={clear}
          className="shrink-0 text-lg leading-none text-[var(--color-muted)] hover:text-white"
          aria-label="Stop and close player"
          title="Stop and close player"
        >
          ×
        </button>

        {deck.error && (
          <span className="ml-1 text-[11px] text-red-400" title={deck.error}>
            ⚠ Error
          </span>
        )}
      </div>
    </div>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-[var(--color-bg)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--color-muted)]">
      {children}
    </span>
  )
}
