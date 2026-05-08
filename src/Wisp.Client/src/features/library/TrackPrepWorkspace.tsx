import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Track } from '../../api/types'
import { useAudioDeck } from '../../audio/useAudioDeck'
import { usePlayer } from '../../state/player'
import { useUiPrefs, type InspectorTab as Tab } from '../../state/uiPrefs'
import { cues as cuesApi } from '../../api/cues'
import { bridge, bridgeAvailable } from '../../bridge'
import { CuesTab, MetadataTab, NotesTab, OverviewTab, TagsTab } from '../inspector/tabContent'
import { BandedWaveform } from '../player/BandedWaveform'
import { RecommendationsList } from './RecommendationPanel'
import { BpmPill, EnergyPill, KeyPill } from './pills'
import { formatDuration } from './format'

interface Props {
  track: Track
  onClose: () => void
  onAddToChain?: (trackId: string) => void
  onCleanup?: (track: Track) => void
  onArchive?: (track: Track) => void
  /// One-shot signal to focus a specific tab (e.g. R keyboard shortcut for Recommendations).
  focusTab?: Tab
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'recommendations', label: 'Recommendations' },
  { id: 'cues', label: 'Cues' },
  { id: 'notes', label: 'Notes' },
  { id: 'tags', label: 'Tags' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'overview', label: 'Overview' },
]

/// Top-of-Library workspace that takes over the page when a track is selected.
/// Reuses the inspector tab content under a horizontal layout — the right-rail
/// inspector panel is gone, this is the new home.
///
/// Layout (top → bottom):
///   1. Big banded waveform (re-uses BandedWaveform; click-to-seek + cue markers later in 20c)
///   2. Title row + close button
///   3. Pill row (Key / BPM / Energy / Cues / Duration)
///   4. Action row (Play / Add to mix / Find matches / Tag / Notes / Archive / Reveal / Cleanup)
///   5. Tab bar
///   6. Tab content (max-height ~240px so library table below stays usable)
///
/// The whole thing collapses to a slim title + play strip via the chevron at the top right —
/// useful when the user wants to keep the workspace mounted (so cue marks / playhead stay live)
/// but reclaim vertical space for the library.
export function TrackPrepWorkspace({
  track,
  onClose,
  onAddToChain,
  onCleanup,
  onArchive,
  focusTab,
}: Props) {
  const lastTab = useUiPrefs((s) => s.lastInspectorTab)
  const setLastTab = useUiPrefs((s) => s.setLastInspectorTab)
  const collapsed = useUiPrefs((s) => s.inspectorCollapsed)
  const toggleCollapsed = useUiPrefs((s) => s.toggleInspectorCollapsed)

  // The "Overview" tab made sense in the side panel — it summarised key metadata
  // because the side panel was narrow. In the wide workspace, Overview's content
  // is already visible (chips + actions are on the workspace itself), so default
  // to Recommendations instead. We still honour whatever the user last picked.
  const [tab, setTab] = useState<Tab>(lastTab === 'overview' ? 'recommendations' : lastTab)

  const switchTab = (next: Tab) => {
    setTab(next)
    setLastTab(next)
  }

  // Honour parent-driven tab focus (R shortcut, ✨ Find matches button).
  useEffect(() => {
    if (focusTab) {
      setTab(focusTab)
      setLastTab(focusTab)
    }
  }, [focusTab, setLastTab])

  // Player state — drives the play/pause label + the waveform's playhead + click-to-seek.
  const playTrack = usePlayer((s) => s.playTrack)
  const playerTrackId = usePlayer((s) => s.trackId)
  const isPlaying = usePlayer((s) => s.isPlaying)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const seek = usePlayer((s) => s.seek)
  const isLoadedHere = playerTrackId === track.id

  // The waveform needs current time + duration. The mini-player owns the audio
  // element; here we read its state via the same `usePlayer` mirror. When the
  // selected track ISN'T loaded in the player yet we use a stand-in deck so the
  // waveform can still render (with a dead playhead).
  //
  // If the track IS loaded, mirror through the store so we don't double-instantiate.
  const standInDeck = useAudioDeck(isLoadedHere ? null : track.id)
  const liveTime = usePlayer((s) => s.position)
  const liveDuration = usePlayer((s) => s.duration)
  const currentTime = isLoadedHere ? liveTime : standInDeck.currentTime
  const duration = isLoadedHere
    ? (liveDuration > 0 ? liveDuration : track.durationSeconds)
    : (standInDeck.duration > 0 ? standInDeck.duration : track.durationSeconds)

  // Cue count for the chip row.
  const cuesQuery = useQuery({
    queryKey: ['cues', track.id],
    queryFn: () => cuesApi.list(track.id),
    staleTime: 30_000,
  })
  const cueCount = cuesQuery.data?.length ?? 0

  const playLabel = useMemo(() =>
    isLoadedHere && isPlaying ? '❚❚ Pause' : '▶ Play',
  [isLoadedHere, isPlaying])

  const handlePlayClick = () => {
    if (isLoadedHere) togglePlay()
    else playTrack(track.id)
  }

  const handleSeek = (t: number) => {
    if (isLoadedHere) {
      seek(t)
    } else {
      // Promote to the active player + store the desired seek time so the player
      // jumps once it's loaded. For now: just kick playback at the start.
      // (Phase 12-style "playTrack" auto-starts; the user can re-click on the
      //  waveform once it's live to land on the precise time.)
      playTrack(track.id)
    }
  }

  // Collapsed mode — slim strip with title + play + close. Keeps the workspace
  // mounted (waveform component cached) but reclaims most vertical space.
  if (collapsed) {
    return (
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <button
          onClick={handlePlayClick}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-xs text-white"
          title={playLabel}
          aria-label={playLabel}
        >
          {isLoadedHere && isPlaying ? '❚❚' : '▶'}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={track.title ?? ''}>
            {track.title ?? track.fileName}
          </p>
          <p className="truncate text-xs text-[var(--color-muted)]">
            {track.artist ?? 'Unknown'}
            {track.version ? ` · ${track.version}` : ''}
          </p>
        </div>
        <button
          onClick={toggleCollapsed}
          className="text-[var(--color-muted)] hover:text-white"
          title="Expand workspace"
          aria-label="Expand workspace"
        >
          ▾
        </button>
        <button
          onClick={onClose}
          className="text-lg leading-none text-[var(--color-muted)] hover:text-white"
          title="Close workspace"
          aria-label="Close workspace"
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-col border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Top: waveform + close/collapse buttons floating top-right */}
      <div className="relative px-3 pt-3">
        <BandedWaveform
          trackId={track.id}
          duration={duration}
          currentTime={currentTime}
          onSeek={handleSeek}
          height={120}
        />
        <div className="absolute right-4 top-4 flex items-center gap-1">
          <button
            onClick={toggleCollapsed}
            className="flex h-6 w-6 items-center justify-center rounded bg-[var(--color-bg)]/80 text-xs text-[var(--color-muted)] hover:text-white"
            title="Collapse workspace"
            aria-label="Collapse workspace"
          >
            ▴
          </button>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded bg-[var(--color-bg)]/80 text-base leading-none text-[var(--color-muted)] hover:text-white"
            title="Close workspace"
            aria-label="Close workspace"
          >
            ×
          </button>
        </div>
      </div>

      {/* Title + version */}
      <div className="px-4 pt-2">
        <h2 className="truncate text-base font-semibold" title={track.title ?? ''}>
          {track.title ?? track.fileName}
          {track.version && (
            <span className="ml-2 text-sm font-normal text-[var(--color-muted)]">({track.version})</span>
          )}
        </h2>
        <p className="truncate text-sm text-[var(--color-muted)]" title={track.artist ?? ''}>
          {track.artist ?? 'Unknown artist'}
        </p>
      </div>

      {/* Pill row */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-2 text-xs">
        <KeyPill musicalKey={track.musicalKey} />
        <BpmPill bpm={track.bpm} />
        <EnergyPill energy={track.energy} />
        <Pill>{formatDuration(track.durationSeconds)}</Pill>
        <Pill>{cueCount} {cueCount === 1 ? 'cue' : 'cues'}</Pill>
        {track.genre && <Pill muted>{track.genre}</Pill>}
        {track.releaseYear && <Pill muted>{track.releaseYear}</Pill>}
      </div>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button
          onClick={handlePlayClick}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white"
        >
          {playLabel}
        </button>
        {onAddToChain && (
          <ActionButton onClick={() => onAddToChain(track.id)} title="Add to active mix plan">
            + Add to mix
          </ActionButton>
        )}
        <ActionButton onClick={() => switchTab('recommendations')} title="Find compatible tracks">
          ✨ Find matches
        </ActionButton>
        <ActionButton onClick={() => switchTab('tags')} title="Edit tags">
          🏷 Tag
        </ActionButton>
        <ActionButton onClick={() => switchTab('notes')} title="Edit notes">
          📝 Notes
        </ActionButton>
        {(track.isDirtyName || track.isMissingMetadata) && onCleanup && (
          <ActionButton
            onClick={() => onCleanup(track)}
            tone="warn"
            title="Cleanup suggested"
          >
            ⚠ Cleanup
          </ActionButton>
        )}
        {onArchive && (
          <ActionButton
            onClick={() => onArchive(track)}
            title={track.isArchived ? 'Restore to active library' : 'Retire from active library'}
          >
            {track.isArchived ? '♻ Restore' : '📦 Archive'}
          </ActionButton>
        )}
        {bridgeAvailable() && (
          <ActionButton
            onClick={() => { void bridge.openInExplorer(track.filePath) }}
            title="Reveal in Explorer"
          >
            ↗ Reveal
          </ActionButton>
        )}
      </div>

      {/* Tab bar */}
      <nav className="flex overflow-x-auto border-t border-[var(--color-border)] text-xs">
        {TABS.map((t) => (
          <TabButton
            key={t.id}
            active={tab === t.id}
            onClick={() => switchTab(t.id)}
          >
            {t.label}
          </TabButton>
        ))}
      </nav>

      {/* Tab content — capped height so the library table below stays usable.
          Each tab is internally scrollable. */}
      <div className="max-h-[14rem] min-h-0 overflow-hidden border-t border-[var(--color-border)]">
        {tab === 'recommendations' && (
          <RecommendationsList seed={track} onAddToChain={onAddToChain} />
        )}
        {tab === 'cues' && <CuesTab track={track} />}
        {tab === 'notes' && <NotesTab track={track} />}
        {tab === 'tags' && <TagsTab track={track} />}
        {tab === 'metadata' && <MetadataTab track={track} />}
        {tab === 'overview' && <OverviewTab track={track} />}
      </div>
    </div>
  )
}

function Pill({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span className={[
      'rounded bg-[var(--color-bg)] px-2 py-0.5 text-[11px] tabular-nums',
      muted ? 'text-[var(--color-muted)]' : '',
    ].join(' ')}>
      {children}
    </span>
  )
}

function ActionButton({
  onClick,
  title,
  tone,
  children,
}: {
  onClick: () => void
  title?: string
  tone?: 'warn'
  children: React.ReactNode
}) {
  const cls = tone === 'warn'
    ? 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
    : 'border-[var(--color-border)] text-[var(--color-muted)] hover:bg-white/5 hover:text-white'
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded-md border px-3 py-1.5 text-xs ${cls}`}
    >
      {children}
    </button>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'shrink-0 px-4 py-2 transition-colors',
        active
          ? 'border-b-2 border-[var(--color-accent)] text-white'
          : 'border-b-2 border-transparent text-[var(--color-muted)] hover:text-white',
      ].join(' ')}
    >
      {children}
    </button>
  )
}
