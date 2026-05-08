import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Track } from '../../api/types'
import { tracks as tracksApi } from '../../api/library'
import { usePlayer } from '../../state/player'
import { useUiPrefs, type InspectorTab as Tab } from '../../state/uiPrefs'
import { bridge, bridgeAvailable } from '../../bridge'
import { useCues } from '../cues/useCues'
import { CuesTab, MetadataTab, NotesTab, OverviewTab, TagsTab } from '../inspector/tabContent'
import { BandedWaveform } from '../player/BandedWaveform'
import { RecommendationsList } from './RecommendationPanel'
import { BpmPill, EnergyPill, KeyPill } from './pills'
import { formatDuration } from './format'
import { detectFirstBeatFromPeaks, loadBandedPeaks } from '../../audio/peaks'
import { snapToBeat } from '../../audio/snap'
import { detectStructuralCues } from '../../audio/structure'

interface Props {
  /// Drives off the App-level player state — workspace appears whenever a track
  /// is loaded into the player (whether playback was started or not). Caller
  /// just renders this; it self-hides if no track is loaded.
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

/// Top-of-Library workspace for the *currently loaded* track — the one in the
/// player. Single-click selection on a library row no longer opens this; users
/// have to either play the track (double-click / row ▶) or use a context menu
/// item that explicitly loads it (e.g. "Notes…" / "Tag…"). That keeps casual
/// browsing free of workspace pop-ups.
///
/// Layout (top → bottom):
///   1. Big banded waveform (re-uses BandedWaveform; cue markers come in 20c)
///   2. Title row + close button (close clears the player → workspace hides)
///   3. Pill row (Key / BPM / Energy / Cues / Duration)
///   4. Action row (Play / Add to mix / Find matches / Tag / Notes / Archive / Reveal / Cleanup)
///   5. Tab bar
///   6. Tab content (max-height ~14rem so library table below stays usable)
///
/// The whole thing collapses to a slim title + play strip via the chevron at the top right.
export function TrackPrepWorkspace({
  onAddToChain,
  onCleanup,
  onArchive,
  focusTab,
}: Props) {
  const trackId = usePlayer((s) => s.trackId)
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

  // Player state — workspace and player are 1:1 now: workspace renders for whatever
  // track the player has loaded.
  const isPlaying = usePlayer((s) => s.isPlaying)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const seek = usePlayer((s) => s.seek)
  const playTrack = usePlayer((s) => s.playTrack)
  const clear = usePlayer((s) => s.clear)
  const liveTime = usePlayer((s) => s.position)
  const liveDuration = usePlayer((s) => s.duration)

  // Cues for the chip count + waveform markers + the Q hotkey's "add at playhead".
  // useCues already exposes the create/update/delete mutations the CuesTab consumes;
  // we hook into the same hook so the workspace's add-cue and the tab share state.
  const cuesHook = useCues(trackId)
  const cueCount = cuesHook.cues.length
  const cueMarkers = useMemo(
    () => cuesHook.cues.map((c) => ({
      id: c.id,
      timeSeconds: c.timeSeconds,
      label: c.label || c.type,
      isAutoSuggested: c.isAutoSuggested,
    })),
    [cuesHook.cues],
  )

  const playLabel = useMemo(() =>
    isPlaying ? '❚❚ Pause' : '▶ Play',
  [isPlaying])

  const handleClose = () => {
    // Closing the workspace stops + unloads the player. (If the user just wanted
    // to free vertical space without losing playback, the ▴ collapse button is
    // the right tool — the workspace stays mounted, just visually slim.)
    clear()
  }

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
    if (!trackId || !track) return
    const rawTime = hoverTimeRef.current ?? (liveTime > 0 ? liveTime : null)
    if (rawTime === null || rawTime < 0) return

    const firstBeat = cuesHook.cues.find((c) => c.type === 'FirstBeat')?.timeSeconds ?? null
    const snapped = opts?.bypassSnap
      ? rawTime
      : snapToBeat(rawTime, track.bpm, firstBeat)

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
    if (!trackId || !track) return
    if (cuesHook.loading) return
    if (autoCueAttemptedRef.current.has(trackId)) return

    let cancelled = false
    const tid = trackId
    autoCueAttemptedRef.current.add(tid)

    const hasFirstBeat = cuesHook.cues.some((c) => c.type === 'FirstBeat')
    const hasStructural = cuesHook.cues.some((c) => c.type === 'Drop' || c.type === 'Breakdown' || c.type === 'Outro')

    loadBandedPeaks(tid)
      .then((peaks) => {
        if (cancelled) return
        const detectedFirstBeat = detectFirstBeatFromPeaks(peaks, track.durationSeconds)

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
        const anchor = cuesHook.cues.find((c) => c.type === 'FirstBeat')?.timeSeconds
          ?? detectedFirstBeat
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
  }, [trackId, cuesHook.loading])

  // Hotkeys: Q adds a cue (at the magnifier hover position if the cursor is
  // over the waveform, otherwise at the playhead); 1-8 jump to the Nth cue.
  // Skipped while the user is typing in inputs (notes textarea, tag input, etc.)
  // so they don't fire when the user means to type Q or a digit.
  useEffect(() => {
    if (!trackId) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
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
  }, [trackId, cuesHook.cues, liveTime])

  // Self-hide if no track loaded. App.tsx still renders us, but we render nothing.
  if (!trackId || !track) return null

  const duration = liveDuration > 0 ? liveDuration : track.durationSeconds

  // Collapsed mode — slim strip with title + play + close. Keeps the workspace
  // mounted (waveform component cached) but reclaims most vertical space.
  if (collapsed) {
    return (
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2">
        <button
          onClick={togglePlay}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-xs text-white"
          title={playLabel}
          aria-label={playLabel}
        >
          {isPlaying ? '❚❚' : '▶'}
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
          onClick={handleClose}
          className="text-lg leading-none text-[var(--color-muted)] hover:text-white"
          title="Close workspace (stops playback)"
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
          currentTime={liveTime}
          onSeek={handleSeek}
          cues={cueMarkers}
          // Click on a cue marker / section → seek + start playback from that
          // cue (matches Mixed-in-Key's "click section, play from there"
          // pattern). If the user wants to edit a cue's label/type, the Cues
          // tab is right there in the tab bar.
          onCueClick={(id) => {
            const c = cuesHook.cues.find((x) => x.id === id)
            if (!c) return
            // playTrack on the same id is a no-op for "load" but kicks audio
            // back into play if it was paused; then seek lands the playhead.
            playTrack(track.id)
            setTimeout(() => seek(c.timeSeconds), 50)
          }}
          onHoverChange={(t) => { hoverTimeRef.current = t }}
          bpm={track.bpm}
          firstBeatSec={cuesHook.cues.find((c) => c.type === 'FirstBeat')?.timeSeconds ?? null}
          height={120}
        />
        <div className="absolute right-4 top-4 flex items-center gap-1">
          <button
            onClick={toggleCollapsed}
            className="flex h-6 w-6 items-center justify-center rounded bg-[var(--color-bg)]/80 text-xs text-[var(--color-muted)] hover:text-white"
            title="Collapse workspace (keeps playback)"
            aria-label="Collapse workspace"
          >
            ▴
          </button>
          <button
            onClick={handleClose}
            className="flex h-6 w-6 items-center justify-center rounded bg-[var(--color-bg)]/80 text-base leading-none text-[var(--color-muted)] hover:text-white"
            title="Close workspace (stops playback)"
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
          onClick={togglePlay}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white"
        >
          {playLabel}
        </button>
        {onAddToChain && (
          <ActionButton onClick={() => onAddToChain(track.id)} title="Add to active mix plan">
            + Add to mix
          </ActionButton>
        )}
        <ActionButton
          onClick={() => addCueAtCursorOrPlayhead()}
          title={track.bpm
            ? 'Add a cue at the hovered waveform position (or playhead), snapped to the nearest beat. Same as pressing Q. Shift+Q to place off-grid.'
            : 'Add a cue at the hovered waveform position (or playhead). Same as pressing Q.'}
        >
          ＋ Cue
        </ActionButton>
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
