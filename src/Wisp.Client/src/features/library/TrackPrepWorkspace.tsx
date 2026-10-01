import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Track } from '../../api/types'
import { tracks as tracksApi } from '../../api/library'
import { usePlayer } from '../../state/player'
import { useUiPrefs, type InspectorTab as Tab } from '../../state/uiPrefs'
import { useCurrentPage } from '../../state/currentPage'
import { cues as cuesApi } from '../../api/cues'
import { Button, IconButton } from '../../components/ui/Button'
import { ActionMenu } from '../../components/ui/ActionMenu'
import { SectionTabs } from '../../components/ui/SectionTabs'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { bridge, bridgeAvailable } from '../../bridge'
import { useCues } from '../cues/useCues'
import { useTrackFileDialog } from './TrackFileDialog'
import { PlaybackError } from '../player/PlaybackError'
import { useAudioFiles } from '../../audio/audioFiles'
import { ChevronUp, Pause, Play, Plus, X, MoreHorizontal } from 'lucide-react'
import { CueBank, CuesTab, MetadataTab, NotesTab, TagsTab } from '../inspector/tabContent'
import { BandedWaveform } from '../player/BandedWaveform'
import { ConvertToMp3Button } from '../transcoder/ConvertToMp3'
import { RecommendationsList } from './RecommendationPanel'
import { BpmPill, KeyPill } from './pills'
import { formatCueTime, formatDuration } from './format'
import {
  detectDownbeatFromPeaks,
  detectFirstBeatFromPeaks,
  loadBandedPeaks,
} from '../../audio/peaks'
import { snapToBeat } from '../../audio/snap'
import { detectStructuralCues } from '../../audio/structure'

interface Props {
  active: boolean
  onAddToChain?: (trackId: string) => void
  onCleanup?: (track: Track) => void
  onArchive?: (track: Track) => void
  /// One-shot signal to focus a specific tab (e.g. R keyboard shortcut for Recommendations).
  focusTab?: Tab
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'cues', label: 'Markers' },
  { id: 'notes', label: 'Notes' },
  { id: 'tags', label: 'Tags' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'recommendations', label: 'Matches' },
]

/// Deliberately opened preparation view. Its audio controller stays at App level.
/// Focus list hides this presentation, preserving zoom and in-session drafts.
export function TrackPrepWorkspace({
  active,
  onAddToChain,
  onCleanup,
  onArchive,
  focusTab,
}: Props) {
  const trackId = usePlayer((s) => s.trackId)
  const playbackError = usePlayer((s) => s.error)
  const audioRevision = useAudioFiles((s) => s.revisions[trackId ?? ''] ?? 0)
  // Fetch the loaded track's metadata so we can show title/artist/chips/etc.
  // Same query the MiniPlayer uses — TanStack caches it cross-component.
  const trackQuery = useQuery({
    queryKey: ['track', trackId],
    queryFn: () => tracksApi.get(trackId!),
    enabled: !!trackId,
    staleTime: 60_000,
  })
  const track = trackQuery.data ?? null
  const lastTab = useUiPrefs((s) => s.lastInspectorTab)
  const setLastTab = useUiPrefs((s) => s.setLastInspectorTab)

  // Retire the duplicate Overview tab; keep existing tab preferences compatible.
  const [tab, setTab] = useState<Tab>(lastTab === 'overview' ? 'cues' : lastTab)
  const [windowSeconds, setWindowSeconds] = useState(0)
  const waveformRoot = useRef<HTMLDivElement>(null)
  const [waveformHeight, setWaveformHeight] = useState(140)
  useEffect(() => {
    const node = waveformRoot.current
    if (!node) return
    const observer = new ResizeObserver(() =>
      setWaveformHeight(Math.max(60, Math.round(node.clientHeight))),
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [trackId, track?.id])
  const deviceCues = useQuery({
    queryKey: ['device-cues', trackId],
    queryFn: () => cuesApi.listDeviceCues(trackId!),
    enabled: !!trackId,
  })

  const switchTab = (next: Tab) => {
    useUiPrefs.getState().setInspectorCollapsed(false)
    if (!useUiPrefs.getState().prepDetailsVisible) useUiPrefs.getState().togglePrepDetails()
    setTab(next)
    setLastTab(next)
  }

  // Honour parent-driven tab focus (R shortcut, ✨ Find matches button).
  useEffect(() => {
    if (focusTab) {
      useUiPrefs.getState().setInspectorCollapsed(false)
      if (!useUiPrefs.getState().prepDetailsVisible) useUiPrefs.getState().togglePrepDetails()
      setTab(focusTab)
      setLastTab(focusTab)
    }
  }, [focusTab, setLastTab])

  // Player state — workspace and player are 1:1 now: workspace renders for whatever
  // track the player has loaded.
  const isPlaying = usePlayer((s) => s.isPlaying)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const seek = usePlayer((s) => s.seek)
  const playTrack = usePlayer((s) => s.playTrack)
  const liveTime = usePlayer((s) => s.position)
  const liveDuration = usePlayer((s) => s.duration)

  // Cues for the chip count + waveform markers + the Q hotkey's "add at playhead".
  // useCues already exposes the create/update/delete mutations the CuesTab consumes;
  // we hook into the same hook so the workspace's add-cue and the tab share state.
  const cuesHook = useCues(trackId)
  const cueMarkers = useMemo(
    () =>
      cuesHook.cues.map((c) => ({
        id: c.id,
        timeSeconds: c.timeSeconds,
        label: c.label || c.type,
        isAutoSuggested: c.isAutoSuggested,
      })),
    [cuesHook.cues],
  )

  const playLabel = isPlaying ? 'Pause' : 'Play'

  const handleSeek = (t: number) => seek(t)

  // Hover time on the waveform — populated whenever the cursor is over the
  // BandedWaveform (and therefore the magnifier is showing). Q reads this
  // first so you can hover-and-tap to drop a cue at the precise hovered
  // position instead of the playhead. Lives in a ref so the keydown handler
  // doesn't have to re-bind on every mouse move.
  const hoverTimeRef = useRef<number | null>(null)

  // Adds a cue at the magnifier's hover position when active, otherwise at
  // the current playhead. When BPM + a first-beat anchor are known the
  // resulting time gets snapped to the nearest beat — mouse precision is
  // way coarser than the actual beat grid, so without snap we'd land off-
  // grid even with the magnifier zoomed to the floor. Pass `bypassSnap` to
  // place exactly where the cursor / playhead is (Shift+Q from the keyboard).
  const addCueAtCursorOrPlayhead = (opts?: { bypassSnap?: boolean }) => {
    if (!active || !trackId || !track) return
    const rawTime = hoverTimeRef.current ?? liveTime
    if (rawTime < 0) return

    const firstBeat = cuesHook.cues.find((c) => c.type === 'FirstBeat')?.timeSeconds ?? null
    const snapped = opts?.bypassSnap ? rawTime : snapToBeat(rawTime, track.bpm, firstBeat)

    cuesHook.create.mutate({ timeSeconds: snapped, type: 'Custom' })
  }

  // Auto-drop structural cues the first time we see a track in the workspace.
  // Walks the cached banded peaks (loading them if needed) to find:
  //   • FirstBeat — first low-band sample exceeding 50% of loudest kick
  //   • Breakdown / Drop / Outro — structurally meaningful energy boundaries,
  //     snapped to a 16-bar phrase grid (see audio/structure.ts)
  //
  // Replaces the dumb every-N-beats grid the old "Generate phrases" produced.
  // Auto-suggested markers render amber so the user knows to verify them; any
  // edit demotes them to "approved" via the PATCH endpoint.
  //
  // Tracks attempts in a ref keyed by trackId so we don't re-create the cues
  // if the user deletes them. Skips when the track already has any auto cues
  // for that role, when cues haven't loaded yet, or when peaks fail.
  const autoCueAttemptedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!active || !trackId || !track) return
    // Relinking preserves prep; do not generate new suggestions over it.
    if (audioRevision > 0) return
    if (cuesHook.loading || cuesHook.error) return
    if (autoCueAttemptedRef.current.has(trackId)) return

    let cancelled = false
    const tid = trackId
    autoCueAttemptedRef.current.add(tid)

    const hasFirstBeat = cuesHook.cues.some((c) => c.type === 'FirstBeat')
    const hasStructural = cuesHook.cues.some(
      (c) => c.type === 'Drop' || c.type === 'Breakdown' || c.type === 'Outro',
    )

    loadBandedPeaks(tid)
      .then((peaks) => {
        if (cancelled) return
        // Prefer phase-fitted downbeat detection when BPM is known — it
        // locks the grid against the next 32 kicks instead of just trusting
        // the first audible low-band hit, so off-grid intro percussion
        // doesn't poison every snap downstream. Falls back to the naive
        // first-beat detector when BPM is missing.
        const detectedFirstBeat = track.bpm
          ? detectDownbeatFromPeaks(peaks, track.durationSeconds, track.bpm)
          : detectFirstBeatFromPeaks(peaks, track.durationSeconds)

        if (!hasFirstBeat && detectedFirstBeat !== null) {
          cuesHook.create.mutate({
            timeSeconds: detectedFirstBeat,
            type: 'FirstBeat',
            isAutoSuggested: true,
            label: 'First beat (auto)',
          })
        }

        // Structural detection needs both BPM (for bar-line snapping) and a
        // first-beat anchor (use the existing cue if present, else the freshly
        // detected one). Without either we can't snap, so skip — the user can
        // tag BPM and reload to retry.
        const anchor =
          cuesHook.cues.find((c) => c.type === 'FirstBeat')?.timeSeconds ?? detectedFirstBeat
        if (!hasStructural && track.bpm && anchor !== null && anchor !== undefined) {
          const structural = detectStructuralCues(peaks, track.durationSeconds, track.bpm, anchor)
          for (const cue of structural) {
            cuesHook.create.mutate({
              timeSeconds: cue.timeSeconds,
              type: cue.type,
              isAutoSuggested: true,
              label: cue.label,
            })
          }
        }
      })
      .catch(() => {
        // Peaks compute failed — give up silently. Refreshing the page will
        // hit the cache or retry, so no need to poison the attempted set.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, trackId, track, cuesHook.loading, cuesHook.error, audioRevision])

  // Hotkeys: Q adds a cue (at the magnifier hover position if the cursor is
  // over the waveform, otherwise at the playhead); 1-8 jump to the Nth cue.
  // Skipped while the user is typing in inputs (notes textarea, tag input, etc.)
  // so they don't fire when the user means to type Q or a digit.
  useEffect(() => {
    if (!active || !trackId) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        e.defaultPrevented ||
        document.querySelector('dialog:modal') ||
        (target &&
          (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName) ||
            target.isContentEditable))
      )
        return
      if (e.key === 'q' || e.key === 'Q') {
        // Shift-Q skips beat-snap so you can drop a cue at the exact hovered
        // / playhead time (useful when a track has off-grid moments worth
        // marking).
        addCueAtCursorOrPlayhead({ bypassSnap: e.shiftKey })
        e.preventDefault()
        return
      }
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= 8) {
        const cue = cuesHook.cues[n - 1]
        if (cue) {
          seek(cue.timeSeconds)
          e.preventDefault()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, trackId, cuesHook.cues, liveTime])

  if (!trackId) return null
  // A failed metadata read must not hide the only usable transport or trap
  // the user in an empty preparation pane while the deck keeps playing.
  if (!track)
    return (
      <div className="preparation-workspace">
        <header className="flex items-center gap-3 border-b border-[var(--color-border)] p-4">
          <IconButton small variant="primary" label={playLabel} onClick={togglePlay}>
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </IconButton>
          <h2 className="min-w-0 flex-1 text-sm">
            {trackQuery.isError ? 'Track details unavailable' : 'Loading track details…'}
          </h2>
          <Button small onClick={() => useCurrentPage.getState().setPreparationOpen(false)}>
            Focus list
          </Button>
        </header>
        {trackQuery.isError && (
          <StatusMessage tone="error">
            Could not load track details: {trackQuery.error.message}{' '}
            <Button small onClick={() => void trackQuery.refetch()}>
              Retry track details
            </Button>
          </StatusMessage>
        )}
      </div>
    )

  const duration = liveDuration > 0 ? liveDuration : track.durationSeconds

  /* UI 2: compact browsing lives in MiniPlayer. This view is deliberately
     opened, and closing it never clears the application-lifetime audio deck. */
  const focusList = () => useCurrentPage.getState().setPreparationOpen(false)
  const nudge = (delta: number) => seek(Math.max(0, Math.min(duration, liveTime + delta)))
  const markers = [
    ...cueMarkers,
    ...(deviceCues.data ?? []).map((c) => ({
      id: `device-${c.id}`,
      timeSeconds: c.startSeconds,
      label: `${c.kind === 'Loop' ? 'Loop' : 'Memory'} · ${c.comment ?? ''}`,
      isAutoSuggested: false,
      isDeviceCue: true,
    })),
  ].sort((a, b) => a.timeSeconds - b.timeSeconds)
  const transport = (
    <div className="flex min-h-12 shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
      <IconButton small variant="primary" onClick={togglePlay} label={playLabel}>
        {isPlaying ? (
          <Pause size={12} fill="currentColor" />
        ) : (
          <Play size={12} fill="currentColor" className="translate-x-[1px]" />
        )}
      </IconButton>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={track.title ?? ''}>
          {track.title ?? track.fileName}
        </p>
        <p className="truncate text-xs text-[var(--color-muted)]">
          {track.artist ?? 'Unknown'}
          {track.version ? ` · ${track.version}` : ''}
        </p>
      </div>
      <KeyPill musicalKey={track.musicalKey} />
      <BpmPill bpm={track.bpm} />
      <span className="text-xs tabular-nums text-[var(--color-muted)]">
        {formatDuration(liveTime)} / {formatDuration(duration)}
      </span>
      <Button small onClick={focusList} tooltip="Focus on the list without stopping playback">
        <ChevronUp size={14} /> Focus list
      </Button>
      <IconButton
        small
        variant="quiet"
        onClick={focusList}
        label="Close preparation"
        tooltip="Close preparation without stopping playback"
      >
        <X size={16} strokeWidth={1.75} />
      </IconButton>
    </div>
  )
  return (
    <div className="preparation-workspace">
      {transport}
      <div className="preparation-body">
        <div className="preparation-main">
          <PlaybackError track={track} error={playbackError} />
          {cuesHook.create.error && (
            <StatusMessage tone="error">
              Could not save marker: {cuesHook.create.error.message}. Try Cue again.
            </StatusMessage>
          )}
          <div className="preparation-tools">
            <Button
              small
              onClick={() => addCueAtCursorOrPlayhead()}
              tooltip="Add WISP marker at cursor/playhead, snapped to beat (Q). Shift+Q bypasses snap."
            >
              <Plus size={16} />
              Cue
            </Button>
            {onAddToChain && (
              <Button small onClick={() => onAddToChain(track.id)}>
                <Plus size={16} />
                Add to mix
              </Button>
            )}
            <label className="flex items-center gap-2 text-xs">
              Zoom
              <select
                aria-label="Preparation waveform zoom"
                value={windowSeconds}
                onChange={(e) => setWindowSeconds(Number(e.target.value))}
              >
                <option value={0}>Whole track</option>
                {[60, 20, 6, 2].map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds}s window
                  </option>
                ))}
              </select>
            </label>
            <Button
              small
              onClick={() => nudge(-0.01)}
              tooltip="Move playback position back 10 milliseconds"
            >
              −10 ms
            </Button>
            <span className="text-xs tabular-nums" aria-label="Precise playback position">
              {formatCueTime(liveTime)}
            </span>
            <Button
              small
              onClick={() => nudge(0.01)}
              tooltip="Move playback position forward 10 milliseconds"
            >
              +10 ms
            </Button>
            <ActionMenu
              label="Track actions"
              icon={<MoreHorizontal />}
              items={[
                { label: 'Find matches', onSelect: () => switchTab('recommendations') },
                { label: 'Edit tags', onSelect: () => switchTab('tags') },
                { label: 'Edit notes', onSelect: () => switchTab('notes') },
                ...(onArchive
                  ? [
                      {
                        label: track.isArchived ? 'Restore track' : 'Archive track',
                        onSelect: () => onArchive(track),
                      },
                    ]
                  : []),
                ...(onCleanup && (track.isDirtyName || track.isMissingMetadata)
                  ? [{ label: 'Cleanup…', onSelect: () => onCleanup(track) }]
                  : []),
                ...(bridgeAvailable()
                  ? [
                      {
                        label: 'Reveal in Explorer',
                        onSelect: () => {
                          void bridge.openInExplorer(track.filePath)
                        },
                      },
                    ]
                  : []),
                {
                  label: 'Relink audio file…',
                  onSelect: () => useTrackFileDialog.getState().open(track, 'relink'),
                },
                {
                  label: 'Remove from WISP…',
                  danger: true,
                  onSelect: () => useTrackFileDialog.getState().open(track, 'remove'),
                },
              ]}
            />
          </div>
          <div className="preparation-waveform" ref={waveformRoot}>
            <BandedWaveform
              trackId={track.id}
              duration={duration}
              currentTime={liveTime}
              onSeek={handleSeek}
              cues={markers}
              onHoverChange={(t) => {
                hoverTimeRef.current = t
              }}
              bpm={track.bpm}
              firstBeatSec={cuesHook.cues.find((c) => c.type === 'FirstBeat')?.timeSeconds ?? null}
              height={waveformHeight}
              windowSeconds={windowSeconds}
              onCueClick={(id) => {
                const cue = markers.find((c) => c.id === id)
                if (!cue) return
                playTrack(track.id)
                setTimeout(() => seek(cue.timeSeconds), 50)
              }}
            />
          </div>
          <div className="preparation-caption">
            <span>
              {track.bpm && cuesHook.cues.some((c) => c.type === 'FirstBeat')
                ? 'Beatgrid anchored to FirstBeat marker'
                : 'Set BPM and a FirstBeat marker to anchor the beatgrid'}
            </span>
            <span>Hover + wheel: magnifier zoom · Q: marker · Shift+Q: unsnapped</span>
            <ConvertToMp3Button track={track} />
          </div>
        </div>
        <aside className="preparation-sidebar" aria-label="Track cues and details">
          <CueBank track={track} onJump={(seconds) => seek(seconds)} />
          <SectionTabs label="Track details" active={tab} onSelect={switchTab} items={TABS} />
          <div className="preparation-details" key={track.id}>
            {tab === 'cues' && <CuesTab track={track} />}
            {tab === 'notes' && <NotesTab track={track} />}
            {tab === 'tags' && <TagsTab track={track} />}
            {(tab === 'metadata' || tab === 'overview') && <MetadataTab track={track} />}
            {tab === 'recommendations' && (
              <RecommendationsList seed={track} onAddToChain={onAddToChain} />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
