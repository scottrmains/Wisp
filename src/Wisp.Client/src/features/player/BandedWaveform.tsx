import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { getCachedBandedPeaks, loadBandedPeaks, type BandedPeaks } from '../../audio/peaks'

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
}

/// Mixed-in-Key style multi-band waveform for the mini-player.
/// Each bucket is drawn as a centred bar; the colour mixes the three bands' relative
/// strengths so bass-heavy regions read warm/red and treble-heavy regions read cool/blue.
/// Click anywhere to seek; vertical playhead overlays the current position.
///
/// While peaks are computing, falls back to a thin baseline so the click-to-seek still works.
export function BandedWaveform({ trackId, duration, currentTime, onSeek, cues, onCueClick, height = 80 }: Props) {
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
      ctx.fillStyle = 'rgba(170, 59, 255, 0.15)'
      ctx.fillRect(0, cssHeight / 2 - 0.5, cssWidth, 1)
      return
    }

    const buckets = peaks.low.length
    const mid = cssHeight / 2
    const barWidth = cssWidth / buckets
    const drawW = Math.max(1, barWidth - 0.4)

    // Find the per-band max so we can normalise — a single global max would let one
    // dominant band crush the others. Using per-band max gives the colour blend
    // proper headroom across the whole length of the track.
    const maxLow = arrayMax(peaks.low)
    const maxMid = arrayMax(peaks.mid)
    const maxHigh = arrayMax(peaks.high)

    // For bar height we use the loudest band per bucket so quiet sections don't disappear.
    const ampMax = Math.max(maxLow, maxMid, maxHigh) || 1

    for (let i = 0; i < buckets; i++) {
      const lo = maxLow > 0 ? peaks.low[i] / maxLow : 0
      const md = maxMid > 0 ? peaks.mid[i] / maxMid : 0
      const hi = maxHigh > 0 ? peaks.high[i] / maxHigh : 0

      const total = lo + md + hi || 1
      const r = lo / total
      const g = md / total
      const b = hi / total

      // Heuristic palette tuned for the dark UI: red+orange for bass, green/yellow
      // for mids, cyan/blue for highs. Mixing these via the per-band ratios gives
      // the smooth rainbow MiK is known for.
      const red = Math.round(255 * (r * 1.0 + g * 0.55 + b * 0.0))
      const grn = Math.round(255 * (r * 0.35 + g * 0.85 + b * 0.55))
      const blu = Math.round(255 * (r * 0.0 + g * 0.15 + b * 1.0))

      // Bar height: combined amplitude scaled into the available vertical space.
      // Loud sections still hit the full height; quiet sections show a few pixels.
      const amp = Math.max(lo, md, hi) * (ampMax / 1)
      const h = Math.max(2, amp * (cssHeight - 4))

      ctx.fillStyle = `rgb(${red}, ${grn}, ${blu})`
      ctx.fillRect(i * barWidth, mid - h / 2, drawW, h)
    }
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
  }

  const handleMouseLeave = () => setCursor(null)

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
          highlights the area + reveals its label; clicking anywhere in the
          section seeks (and the workspace then auto-plays from that point).
          Mirrors the Mixed-in-Key pattern of "click a section, play from there"
          — much easier to navigate track structure than hitting a 3px marker.
          Sections render BEFORE markers so the markers stay clickable on top. */}
      {cues && duration > 0 && cues.map((c, i) => {
        const startPct = (c.timeSeconds / duration) * 100
        const nextTime = i + 1 < cues.length ? cues[i + 1].timeSeconds : duration
        const endPct = (nextTime / duration) * 100
        if (startPct >= 100 || endPct <= startPct) return null
        return (
          <button
            key={`section-${c.id}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (onCueClick) onCueClick(c.id)
              else onSeek(c.timeSeconds)
            }}
            title={c.label ? `Play from "${c.label}" · ${formatTimeShort(c.timeSeconds)}` : `Play from ${formatTimeShort(c.timeSeconds)}`}
            className="group absolute top-0 bottom-0 cursor-pointer transition-colors hover:bg-[var(--color-accent)]/15"
            style={{ left: `${startPct}%`, width: `${endPct - startPct}%` }}
            aria-label={c.label ?? `Section starting at ${formatTimeShort(c.timeSeconds)}`}
          >
            {c.label && (
              <span className="pointer-events-none absolute inset-x-1.5 top-1.5 truncate text-left text-[10px] font-semibold uppercase tracking-wide text-white opacity-0 transition-opacity group-hover:opacity-90">
                {c.label}
              </span>
            )}
          </button>
        )
      })}

      {/* Cue markers — thin vertical lines on top of the section overlays so
          they stay precisely clickable. Marker click also calls onCueClick. */}
      {cues && duration > 0 && cues.map((c) => {
        const left = (c.timeSeconds / duration) * 100
        if (left < 0 || left > 100) return null
        const tone = c.isAutoSuggested
          ? 'bg-amber-400/40 hover:bg-amber-400'
          : 'bg-emerald-400/70 hover:bg-emerald-400'
        return (
          <button
            key={c.id}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              if (onCueClick) onCueClick(c.id)
              else onSeek(c.timeSeconds)
            }}
            title={c.label ? `${c.label} · ${formatTimeShort(c.timeSeconds)}` : formatTimeShort(c.timeSeconds)}
            className={`absolute top-0 bottom-0 w-[3px] -translate-x-1/2 cursor-pointer transition-colors ${tone}`}
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
}

const MAGNIFIER_WIDTH = 280
const MAGNIFIER_HEIGHT = 70
const MAGNIFIER_WINDOW_SECONDS = 6

function Magnifier({ peaks, duration, cursorTime, clientX, clientY }: MagnifierProps) {
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

    const buckets = peaks.low.length
    const maxLow = arrayMax(peaks.low) || 1
    const maxMid = arrayMax(peaks.mid) || 1
    const maxHigh = arrayMax(peaks.high) || 1
    const mid = MAGNIFIER_HEIGHT / 2

    const startTime = cursorTime - MAGNIFIER_WINDOW_SECONDS / 2
    const endTime = cursorTime + MAGNIFIER_WINDOW_SECONDS / 2
    const windowSec = endTime - startTime

    // Bar pitch chosen so we always have visible bars even when one bucket
    // covers many pixels at this zoom level.
    const barWidthPx = 2
    const numBars = Math.floor(MAGNIFIER_WIDTH / barWidthPx)
    for (let p = 0; p < numBars; p++) {
      const t = startTime + (p / numBars) * windowSec
      if (t < 0 || t > duration) continue
      const bucket = Math.min(buckets - 1, Math.max(0, Math.floor((t / duration) * buckets)))
      const lo = peaks.low[bucket] / maxLow
      const md = peaks.mid[bucket] / maxMid
      const hi = peaks.high[bucket] / maxHigh
      const total = lo + md + hi || 1
      const r = lo / total
      const g = md / total
      const b = hi / total
      const red = Math.round(255 * (r * 1.0 + g * 0.55 + b * 0.0))
      const grn = Math.round(255 * (r * 0.35 + g * 0.85 + b * 0.55))
      const blu = Math.round(255 * (r * 0.0 + g * 0.15 + b * 1.0))
      const amp = Math.max(lo, md, hi)
      const h = Math.max(2, amp * (MAGNIFIER_HEIGHT - 6))
      ctx.fillStyle = `rgb(${red}, ${grn}, ${blu})`
      ctx.fillRect(p * barWidthPx, mid - h / 2, barWidthPx - 0.4, h)
    }

    // Centre crosshair — marks the exact time the cursor is on.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
    ctx.fillRect(MAGNIFIER_WIDTH / 2 - 0.5, 0, 1, MAGNIFIER_HEIGHT)
  }, [peaks, duration, cursorTime])

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
      <div className="border-t border-white/10 px-2 py-0.5 text-center font-mono text-[10px] text-white/80">
        🔍 {formatTimeFine(cursorTime)} · ±{(MAGNIFIER_WINDOW_SECONDS / 2).toFixed(1)}s
      </div>
    </div>,
    document.body,
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
