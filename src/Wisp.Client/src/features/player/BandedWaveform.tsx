import { useEffect, useRef, useState } from 'react'
import { getCachedBandedPeaks, loadBandedPeaks, type BandedPeaks } from '../../audio/peaks'

interface Props {
  trackId: string
  duration: number
  currentTime: number
  onSeek: (seconds: number) => void
  /// Pixel height of the waveform area. Defaults to 80 to match the mini-player layout.
  height?: number
}

/// Mixed-in-Key style multi-band waveform for the mini-player.
/// Each bucket is drawn as a centred bar; the colour mixes the three bands' relative
/// strengths so bass-heavy regions read warm/red and treble-heavy regions read cool/blue.
/// Click anywhere to seek; vertical playhead overlays the current position.
///
/// While peaks are computing, falls back to a thin baseline so the click-to-seek still works.
export function BandedWaveform({ trackId, duration, currentTime, onSeek, height = 80 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [peaks, setPeaks] = useState<BandedPeaks | null>(() => getCachedBandedPeaks(trackId) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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

  // Draw the waveform whenever peaks or container size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const dpr = window.devicePixelRatio || 1
    const cssWidth = container.clientWidth
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
  }, [peaks, height])

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    onSeek(Math.max(0, Math.min(1, ratio)) * duration)
  }

  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className="relative w-full cursor-pointer overflow-hidden rounded bg-[var(--color-bg)]"
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
      {/* Playhead: bright thin line + soft glow shadow. */}
      <div
        className="pointer-events-none absolute top-0 bottom-0 w-px bg-white shadow-[0_0_4px_rgba(255,255,255,0.7)]"
        style={{ left: `${playheadPct}%` }}
      />
    </div>
  )
}

function arrayMax(a: Float32Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) {
    const v = a[i]
    if (v > m) m = v
  }
  return m
}
