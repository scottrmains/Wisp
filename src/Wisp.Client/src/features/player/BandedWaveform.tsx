import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getCachedBandedPeaks, loadBandedPeaks, type BandedPeaks } from '../../audio/peaks'
import { beatTicksInRange, snapToBeat } from '../../audio/snap'

export interface CueMarker {
  id: string
  timeSeconds: number
  /// Optional label rendered as a tooltip on the marker. Truncated cleanly by the browser.
  label?: string
  /// True when slskd / external generation suggested this; renders subtler.
  isAutoSuggested?: boolean
}

interface Props {
  trackId: string
  duration: number
  currentTime: number
  onSeek: (seconds: number) => void
  /// Cue markers to overlay. Each renders as a thin vertical strip clickable to jump.
  /// The workspace passes its loaded track's cues; the mini-player leaves this empty.
  cues?: CueMarker[]
  /// Fired when a cue marker (not the empty waveform) is clicked. The waveform's own
  /// click-to-seek handler ignores clicks on cue markers via the marker's stopPropagation.
  onCueClick?: (cueId: string) => void
  /// Pixel height of the waveform area. Defaults to 80 to match the mini-player layout.
  height?: number
  /// Fires when the user hovers over the waveform with timestamp at the cursor,
  /// or null when the cursor leaves. Lets the parent (workspace) wire hotkeys
  /// like Q to "place a cue at the hovered position" instead of the playhead.
  onHoverChange?: (timeSeconds: number | null) => void
  /// Track tempo. Optional — when provided, the magnifier overlays beat
  /// ticks so the user can see the snap grid before placing a cue.
  bpm?: number | null
  /// Time of beat 0 used to anchor the beat grid. Without this we don't know
  /// where the kick lands so beat ticks would be cosmetic noise.
  firstBeatSec?: number | null
}

/// Flat-cyan waveform render in the Mixed-in-Key style. Every bucket is drawn
/// as a centred bar mirrored top + bottom around the midline; the colour is
/// solid cyan rather than per-band-mixed. Multi-band info (low/mid/high) is
/// still computed but it feeds the structural-cue detector now, not the
/// rendering — the visual is calmer and the kick / snare transients read more
/// clearly because they're not competing with band-blend colour shifts.
/// Click anywhere to seek; vertical playhead overlays the current position.
///
/// While peaks are computing, falls back to a thin baseline so the click-to-seek still works.
export function BandedWaveform({ trackId, duration, currentTime, onSeek, cues, onCueClick, height = 80, onHoverChange, bpm, firstBeatSec }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [peaks, setPeaks] = useState<BandedPeaks | null>(() => getCachedBandedPeaks(trackId) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Cursor tracking for the precise-time tooltip + magnifier popover. Set on
  // mousemove, cleared on mouseleave. `x` is local to the canvas (drives the
  // in-canvas guide line); `clientX/clientY` are viewport coords for the
  // portal-rendered magnifier. `time` is the timestamp under the cursor.
  const [cursor, setCursor] = useState<{ x: number; clientX: number; clientY: number; time: number } | null>(null)
  // Mirror of `cursor != null` for the native wheel listener to read without
  // forcing a listener re-attach on every mousemove.
  const cursorActiveRef = useRef(false)
  // Magnifier zoom level — total seconds visible in the popover. Scroll
  // wheel adjusts this between MIN/MAX_WINDOW so the user can zoom in to
  // sub-second precision when they need it.
  const [magnifierWindowSec, setMagnifierWindowSec] = useState(MAGNIFIER_DEFAULT_WINDOW)
  // Tracks the container's measured width so the canvas redraws when the
  // wrapper toggles visibility (display:none → block goes 0 → realW, which
  // ResizeObserver reports as a resize). Without this, the canvas stays at
  // 0px wide if peaks resolved while the parent was hidden — leaves a blank
  // strip when the user navigates back to a page where MiniPlayer shows.
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr) setContainerWidth(cr.width)
    })
    ro.observe(el)
    // Initial measurement (ResizeObserver fires on first observe in modern browsers,
    // but explicit set is harmless and protects against any edge case).
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Load (or read from cache) the banded peaks for this track.
  useEffect(() => {
    setError(null)
    const cached = getCachedBandedPeaks(trackId)
    if (cached) {
      setPeaks(cached)
      return
    }
    let cancelled = false
    setPeaks(null)
    setLoading(true)
    loadBandedPeaks(trackId)
      .then((p) => {
        if (!cancelled) setPeaks(p)
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [trackId])

  // Draw the waveform whenever peaks, height, or container size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    // Skip when the container has no real width yet — drawing at 0 would lock
    // the canvas at 0×N until something forced another redraw, which is the
    // exact bug ResizeObserver above is here to prevent. Wait for the next
    // resize event (which will fire when the parent becomes visible).
    if (containerWidth <= 0) return

    const dpr = window.devicePixelRatio || 1
    const cssWidth = containerWidth
    const cssHeight = height
    canvas.width = Math.floor(cssWidth * dpr)
    canvas.height = Math.floor(cssHeight * dpr)
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`

    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, cssWidth, cssHeight)

    if (!peaks) {
      // Baseline so the area still reads as "the waveform" while peaks compute.
      ctx.fillStyle = WAVEFORM_COLOR_DIM
      ctx.fillRect(0, cssHeight / 2 - 0.5, cssWidth, 1)
      return
    }

    drawWaveformBars(ctx, peaks.full, cssWidth, cssHeight)
  }, [peaks, height, containerWidth])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    onSeek(Math.max(0, Math.min(1, ratio)) * duration)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left))
    const time = (x / rect.width) * duration
    setCursor({ x, clientX: e.clientX, clientY: e.clientY, time })
    cursorActiveRef.current = true
    onHoverChange?.(time)
  }

  const handleMouseLeave = () => {
    setCursor(null)
    cursorActiveRef.current = false
    onHoverChange?.(null)
  }

  // Wheel-to-zoom on the magnifier. React's synthetic onWheel listeners are
  // attached as passive in modern React, which means preventDefault() is a
  // no-op — the page would scroll behind the waveform. Attach the wheel
  // listener natively with passive:false so we can stop the default scroll
  // when the cursor is over the waveform. Reads cursor state via ref so
  // mousemove churn doesn't re-attach this listener every frame.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!cursorActiveRef.current) return
      e.preventDefault()
      // deltaY positive = scroll down (mousewheel away) → zoom out (larger window).
      // Negative = scroll up (toward user) → zoom in. Multiplicative step gives
      // even feel across the zoom range.
      const factor = e.deltaY > 0 ? MAGNIFIER_WHEEL_FACTOR : 1 / MAGNIFIER_WHEEL_FACTOR
      setMagnifierWindowSec((prev) =>
        Math.max(MAGNIFIER_MIN_WINDOW, Math.min(MAGNIFIER_MAX_WINDOW, prev * factor)),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative w-full cursor-crosshair overflow-hidden rounded bg-[var(--color-bg)]"
      style={{ height }}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={currentTime}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      {loading && (
        <div className="absolute inset-x-0 top-1 text-center text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          Computing waveform…
        </div>
      )}
      {error && (
        <div className="absolute inset-x-0 top-1 text-center text-[10px] text-red-400" title={error}>
          waveform unavailable
        </div>
      )}
      {/* Cue sections — wide hover regions BETWEEN markers. Hovering a section
          tints the area + reveals its label and a "▶" play-from-cue button.
          The section itself does NOT handle clicks — clicks bubble up to the
          container's seek-to-click handler so clicking the waveform always
          seeks to the click point. To play from the cue's start, hover the
          section and click the floating play button. Mirrors the Mixed-in-Key
          model where the click point is "go here exactly" and the per-cue
          play affordance is "start from this cue". Sections render BEFORE
          markers so markers stay clickable on top. */}
      {cues && duration > 0 && cues.map((c, i) => {
        const startPct = (c.timeSeconds / duration) * 100
        const nextTime = i + 1 < cues.length ? cues[i + 1].timeSeconds : duration
        const endPct = (nextTime / duration) * 100
        if (startPct >= 100 || endPct <= startPct) return null
        return (
          <div
            key={`section-${c.id}`}
            className="group absolute top-0 bottom-0 transition-colors hover:bg-[var(--color-accent)]/15"
            style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
          >
            {/* Play-from-cue affordance. Stops propagation so it doesn't also
                trigger the container's click-to-seek handler underneath. */}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                if (onCueClick) onCueClick(c.id)
                else onSeek(c.timeSeconds)
              }}
              title={c.label
                ? `Play from "${c.label}" · ${formatTimeShort(c.timeSeconds)}`
                : `Play from cue · ${formatTimeShort(c.timeSeconds)}`}
              aria-label={c.label
                ? `Play from ${c.label}`
                : `Play from cue at ${formatTimeShort(c.timeSeconds)}`}
              className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent)] text-[9px] leading-none text-white opacity-0 shadow transition-opacity hover:scale-110 group-hover:opacity-95"
            >
              ▶
            </button>
            {c.label && (
              <span className="pointer-events-none absolute left-7 right-1.5 top-1.5 truncate text-left text-[10px] font-semibold uppercase tracking-wide text-white opacity-0 transition-opacity group-hover:opacity-90">
                {c.label}
              </span>
            )}
          </div>
        )
      })}

      {/* Cue markers — thin vertical lines drawn on top of the section
          overlays. Pointer-events:none so clicks pass through to the
          container's seek-to-click handler (clicking a marker seeks to
          its own time, which is the same as clicking the cue's spot on
          the bare waveform). The play-from-cue affordance is the ▶
          button inside the section overlay, not the marker itself. */}
      {cues && duration > 0 && cues.map((c) => {
        const left = (c.timeSeconds / duration) * 100
        if (left < 0 || left > 100) return null
        const tone = c.isAutoSuggested ? 'bg-amber-400/60' : 'bg-emerald-400/80'
        return (
          <div
            key={c.id}
            title={c.label ? `${c.label} · ${formatTimeShort(c.timeSeconds)}` : formatTimeShort(c.timeSeconds)}
            className={`pointer-events-none absolute top-0 bottom-0 w-[3px] -translate-x-1/2 ${tone}`}
            style={{ left: `${left}%` }}
            aria-label={c.label ?? `Cue at ${formatTimeShort(c.timeSeconds)}`}
          />
        )
      })}
      {/* Playhead: bright thin line + soft glow shadow. */}
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-white shadow-[0_0_4px_rgba(255,255,255,0.7)]"
        style={{ left: `${playheadPct}%` }}
      />
      {/* Hover cursor: dashed guide line + time chip on the waveform itself.
          Always-on whenever the user's mouse is over the waveform — gives the
          precise time at the pointer so they can see what they'd seek to. */}
      {cursor && (
        <>
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-white/40"
            style={{ left: cursor.x }}
          />
          <div
            className="pointer-events-none absolute top-1 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-mono text-white/90"
            style={{ left: cursor.x }}
          >
            {formatTimeFine(cursor.time)}
          </div>
        </>
      )}
      {/* Magnifier popover — floats above the waveform near the cursor and
          draws a zoomed window of the same banded peaks. Pixel-to-time
          mapping inside the magnifier is much finer than the main waveform
          (typical ~0.04s/px vs ~0.3s/px), so the user can pinpoint exactly
          where to seek/place a cue. Rendered via a portal into document.body
          so parent overflow:hidden chains (the workspace card, page scroll
          container, etc.) can't clip it. Pointer-events:none so it never
          steals clicks from the waveform underneath. */}
      {cursor && peaks && duration > 0 && (
        <Magnifier
          peaks={peaks}
          duration={duration}
          cursorTime={cursor.time}
          clientX={cursor.clientX}
          clientY={cursor.clientY}
          windowSec={magnifierWindowSec}
          bpm={bpm ?? null}
          firstBeatSec={firstBeatSec ?? null}
        />
      )}
    </div>
  )
}

interface MagnifierProps {
  peaks: BandedPeaks
  duration: number
  cursorTime: number
  clientX: number
  clientY: number
  /// Total seconds visible inside the magnifier (zoom level). Smaller = more
  /// zoomed in. Driven by the parent's wheel handler.
  windowSec: number
  /// Track tempo + first-beat anchor — when both are present the magnifier
  /// overlays beat / bar / phrase tick lines so the user can see the grid
  /// they'll snap to. Otherwise the magnifier is purely visual.
  bpm: number | null
  firstBeatSec: number | null
}

const MAGNIFIER_WIDTH = 280
const MAGNIFIER_HEIGHT = 70
const MAGNIFIER_DEFAULT_WINDOW = 6
const MAGNIFIER_MIN_WINDOW = 0.5
const MAGNIFIER_MAX_WINDOW = 30
const MAGNIFIER_WHEEL_FACTOR = 1.2

function Magnifier({ peaks, duration, cursorTime, clientX, clientY, windowSec, bpm, firstBeatSec }: MagnifierProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(MAGNIFIER_WIDTH * dpr)
    canvas.height = Math.floor(MAGNIFIER_HEIGHT * dpr)
    canvas.style.width = `${MAGNIFIER_WIDTH}px`
    canvas.style.height = `${MAGNIFIER_HEIGHT}px`

    const ctx = canvas.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, MAGNIFIER_WIDTH, MAGNIFIER_HEIGHT)

    const startTime = cursorTime - windowSec / 2
    drawZoomedWaveformBars(
      ctx,
      peaks.full,
      MAGNIFIER_WIDTH,
      MAGNIFIER_HEIGHT,
      startTime,
      windowSec,
      duration,
    )

    // Beat grid overlay — drawn UNDER the centre crosshair so the white
    // crosshair stays visible. Only rendered when we have BPM + a first-beat
    // anchor, otherwise we'd just be guessing about where beats land. The
    // weight from beatTicksInRange controls opacity so phrase / bar / beat
    // boundaries are visually distinguishable.
    const endTime = cursorTime + windowSec / 2
    const ticks = beatTicksInRange(startTime, endTime, bpm, firstBeatSec)
    for (const tick of ticks) {
      const xRatio = (tick.timeSeconds - startTime) / windowSec
      if (xRatio < 0 || xRatio > 1) continue
      const x = xRatio * MAGNIFIER_WIDTH
      const alpha = 0.15 + tick.weight * 0.55
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`
      // Phrase + bar lines extend full height; plain beats are short ticks
      // at top + bottom so they don't visually compete with the waveform.
      if (tick.weight >= 0.6) {
        ctx.fillRect(x - 0.5, 0, 1, MAGNIFIER_HEIGHT)
      } else {
        ctx.fillRect(x - 0.5, 0, 1, 6)
        ctx.fillRect(x - 0.5, MAGNIFIER_HEIGHT - 6, 1, 6)
      }
    }

    // Snap target — when BPM + first-beat are known, draw a brighter cyan
    // line at the beat the cue would actually land on if the user pressed
    // Q right now. Sits between the dim beat-grid ticks (which mark every
    // beat) and the white crosshair (which marks the literal cursor): this
    // line is the answer to "what's about to happen if I commit?".
    if (bpm && bpm > 0 && firstBeatSec !== null && firstBeatSec !== undefined) {
      const snapTime = snapToBeat(cursorTime, bpm, firstBeatSec)
      const snapRatio = (snapTime - startTime) / windowSec
      if (snapRatio >= 0 && snapRatio <= 1) {
        const snapX = snapRatio * MAGNIFIER_WIDTH
        // Soft outer glow first so it reads even at deep zoom where the
        // line might overlap a tall waveform bar.
        ctx.fillStyle = 'rgba(74, 222, 128, 0.20)'
        ctx.fillRect(snapX - 2, 0, 5, MAGNIFIER_HEIGHT)
        // Bright core line.
        ctx.fillStyle = 'rgba(74, 222, 128, 0.95)'
        ctx.fillRect(snapX - 0.5, 0, 1.5, MAGNIFIER_HEIGHT)
      }
    }

    // Centre crosshair — marks the exact time the cursor is on. Drawn last
    // so it always sits on top of the beat grid + snap indicator.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)'
    ctx.fillRect(MAGNIFIER_WIDTH / 2 - 0.5, 0, 1, MAGNIFIER_HEIGHT)
  }, [peaks, duration, cursorTime, windowSec, bpm, firstBeatSec])

  // Position the popover via fixed coords on the viewport. Place it just
  // above the cursor; flip to below when the cursor is near the top of the
  // viewport so the magnifier never gets cut off by the window chrome.
  // Clamp horizontally so the right edge doesn't overflow the viewport.
  const verticalOffset = 22 // gap between cursor and popover edge
  const popoverHeight = MAGNIFIER_HEIGHT + 18 // canvas + footer
  const preferTop = clientY - popoverHeight - verticalOffset
  const top = preferTop >= 4 ? preferTop : clientY + verticalOffset
  const half = MAGNIFIER_WIDTH / 2
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : MAGNIFIER_WIDTH
  const left = Math.max(4, Math.min(viewportW - MAGNIFIER_WIDTH - 4, clientX - half))

  return createPortal(
    <div
      className="pointer-events-none fixed z-[1000] rounded border border-white/15 bg-black/95 shadow-2xl"
      style={{ left, top, width: MAGNIFIER_WIDTH }}
    >
      <canvas ref={canvasRef} className="block" />
      <MagnifierFooter cursorTime={cursorTime} windowSec={windowSec} bpm={bpm} firstBeatSec={firstBeatSec} />
    </div>,
    document.body,
  )
}

function MagnifierFooter({
  cursorTime,
  windowSec,
  bpm,
  firstBeatSec,
}: {
  cursorTime: number
  windowSec: number
  bpm: number | null
  firstBeatSec: number | null
}) {
  const canSnap = !!bpm && bpm > 0 && firstBeatSec !== null && firstBeatSec !== undefined
  const snapTime = canSnap ? snapToBeat(cursorTime, bpm, firstBeatSec) : null
  const snapsTo = snapTime !== null && Math.abs(snapTime - cursorTime) > 0.005

  return (
    <div className="flex items-center justify-between gap-2 border-t border-white/10 px-2 py-0.5 font-mono text-[10px] text-white/80">
      <span>🔍 {formatTimeFine(cursorTime)}</span>
      {snapsTo ? (
        <span className="text-[rgb(74,222,128)]">→ {formatTimeFine(snapTime!)}</span>
      ) : (
        <span className="text-white/50">±{(windowSec / 2).toFixed(windowSec < 2 ? 2 : 1)}s</span>
      )}
    </div>
  )
}

function formatTimeFine(seconds: number): string {
  if (seconds < 0) return '0:00.00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

function formatTimeShort(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function arrayMax(a: Float32Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) {
    const v = a[i]
    if (v > m) m = v
  }
  return m
}

/// Solid sky-blue cyan tuned to match MiK's flat-coloured waveform on a dark
/// background. Bright enough to read at thumbnail height in the mini-player
/// but not so saturated it competes with the playhead / accent UI.
const WAVEFORM_COLOR = 'rgb(56, 189, 248)'
/// Faded version used for the "computing waveform…" baseline + the per-bucket
/// minimum-height fallback when amplitude is near zero.
const WAVEFORM_COLOR_DIM = 'rgba(56, 189, 248, 0.18)'

/// Render the full track as a vertically-mirrored cyan bar chart. One bar per
/// bucket of `peaks` (already pre-downsampled). Mirrors top + bottom around
/// the midline so the result reads as a classic stereo-ish waveform — the
/// look that MiK / Rekordbox / etc. share.
function drawWaveformBars(
  ctx: CanvasRenderingContext2D,
  peaks: Float32Array,
  cssWidth: number,
  cssHeight: number,
) {
  const buckets = peaks.length
  if (buckets === 0) return

  const mid = cssHeight / 2
  const barWidth = cssWidth / buckets
  const drawW = Math.max(1, barWidth)
  const ampMax = arrayMax(peaks) || 1
  // 80% of canvas height for bars leaves visible padding top + bottom — that
  // space is what makes the dynamics "breathe". MiK's waveform sits inside
  // ~80% of its strip; pegging to 100% washes out the energy variation
  // because every loud bucket clips to the canvas edge.
  const usableHeight = cssHeight * 0.8

  ctx.fillStyle = WAVEFORM_COLOR
  for (let i = 0; i < buckets; i++) {
    const amp = peaks[i] / ampMax
    if (amp <= 0) continue
    const h = Math.max(1, amp * usableHeight)
    ctx.fillRect(i * barWidth, mid - h / 2, drawW, h)
  }
}

/// Render a windowed slice of the waveform — same flat cyan look, but each
/// rendered pixel maps a chosen time range so the magnifier can zoom freely.
/// Walks the rendered pixel column and pulls peak amplitude from the source
/// bucket(s) that overlap the time slice for that column. At deep zoom the
/// same bucket repeats across columns, which is honest about the underlying
/// resolution — but the user still sees precise time mapping via the
/// crosshair.
function drawZoomedWaveformBars(
  ctx: CanvasRenderingContext2D,
  peaks: Float32Array,
  cssWidth: number,
  cssHeight: number,
  startTime: number,
  windowSec: number,
  totalDuration: number,
) {
  const buckets = peaks.length
  if (buckets === 0 || totalDuration <= 0) return

  const ampMax = arrayMax(peaks) || 1
  const mid = cssHeight / 2
  const usableHeight = cssHeight * 0.8

  const barWidthPx = 1
  const numBars = Math.floor(cssWidth / barWidthPx)
  ctx.fillStyle = WAVEFORM_COLOR
  for (let p = 0; p < numBars; p++) {
    const t = startTime + (p / numBars) * windowSec
    if (t < 0 || t > totalDuration) continue
    const bucket = Math.min(buckets - 1, Math.max(0, Math.floor((t / totalDuration) * buckets)))
    const amp = peaks[bucket] / ampMax
    if (amp <= 0) continue
    const h = Math.max(1, amp * usableHeight)
    ctx.fillRect(p * barWidthPx, mid - h / 2, barWidthPx, h)
  }
}
