import { useEffect } from 'react'
import { PlaybackError } from './PlaybackError'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Pause, Play, SlidersHorizontal, X } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button'
import { useCurrentPage } from '../../state/currentPage'
import { useUiPrefs } from '../../state/uiPrefs'
import { tracks as tracksApi } from '../../api/library'
import { useAudioDeck } from '../../audio/useAudioDeck'
import { usePlayer } from '../../state/player'
import { formatBpm, formatDuration, trackDisplayTitle } from '../library/format'
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
    setStatus({ isPlaying: deck.isPlaying, position: deck.currentTime, duration: deck.duration, error: deck.error })
  }, [deck.isPlaying, deck.currentTime, deck.duration, deck.error, setStatus])

  // Auto-start once metadata lands, if `playTrack` was the entrypoint.
  useEffect(() => {
    if (deck.duration > 0 && !deck.loading && consumePendingPlay()) {
      void deck.play()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck.duration, deck.loading])

  if (!trackId) return null

  const title = track ? trackDisplayTitle(track) : '…'
  const artist = track?.artist ?? 'Unknown'

  return (
    <div className="compact-player" aria-label="Playback overview">
      {track && <PlaybackError track={track} error={deck.error} />}
      {/* Waveform: full width, click to seek, MiK-style band-coloured bars. */}
      <div className="compact-player-waveform">
        <BandedWaveform
          trackId={trackId}
          duration={deck.duration}
          currentTime={deck.currentTime}
          onSeek={(t) => deck.seek(t)}
          height={32}
        />
      </div>

      {/* Controls strip below the waveform. */}
      <div className="compact-player-controls">
        <IconButton variant="primary"
          onClick={() => void deck.toggle()}
          disabled={deck.loading}
          label={deck.isPlaying ? 'Pause' : 'Play'}
        >
          {deck.loading ? '…' : deck.isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </IconButton>

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

        <Button onClick={() => {
          useUiPrefs.getState().setInspectorCollapsed(false)
          useCurrentPage.getState().setPreparationOpen(true)
          useCurrentPage.getState().setPage('library')
        }} tooltip="Open waveform, beatgrid and cue editor without changing playback">
          <SlidersHorizontal size={16} /> Prepare
        </Button>
        <IconButton variant="quiet"
          onClick={clear}
          label="Stop and close player"
        >
          <X size={16} strokeWidth={1.75} />
        </IconButton>

        {deck.error && (
          <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-red-400" title={deck.error}>
            <AlertTriangle size={12} strokeWidth={1.75} /> Error
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
