import { useEffect, useRef, useState } from 'react'
import { getCachedPeaks, loadPeaks } from '../../audio/peaks'
import type { CuePoint } from '../../api/types'

interface Props {
  trackId: string
  duration: number
  currentTime: number
  onSeek: (seconds: number) => void
  cues?: CuePoint[]
  height?: number
}

/// Canvas waveform of the track. Click to seek. Live playhead overlay.
export function WaveformView({ trackId, duration, currentTime, onSeek, cues, height = 72 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(() => getCachedPeaks(trackId) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Load peaks for this track.
  useEffect(() => {
    setError(null)
    const cached = getCachedPeaks(trackId)
    if (cached) {
      setPeaks(cached)
      return
    }
    let cancelled = false
    setPeaks(null)
    setLoading(true)
    loadPeaks(trackId)
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

  // Draw the waveform whenever peaks or size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !peaks) return

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

    const mid = cssHeight / 2
    const barWidth = cssWidth / peaks.length

    ctx.fillStyle = 'rgba(170, 59, 255, 0.5)'
    for (let i = 0; i < peaks.length; i++) {
      const h = peaks[i] * (cssHeight - 4)
      const x = i * barWidth
      ctx.fillRect(x, mid - h / 2, Math.max(1, barWidth - 0.5), h)
    }
  }, [peaks, height])

  // Click → seek
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    onSeek(ratio * duration)
  }

  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      ref={containerRef}
      onClick={handleClick}
      className="relative w-full cursor-pointer overflow-hidden rounded bg-[var(--color-bg)]"
      style={{ height }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--color-muted)]">
          Computing waveform…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-red-400">
          {error}
        </div>
      )}
      {peaks && (
        <div
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-white"
          style={{ left: `${playheadPct}%` }}
        />
      )}
      {cues && duration > 0 && cues.map((c) => {
        const left = (c.timeSeconds / duration) * 100
        if (left < 0 || left > 100) return null
        return (
          <button
            key={c.id}
            onClick={(e) => {
              e.stopPropagation()
              onSeek(c.timeSeconds)
            }}
            title={`${c.label} · ${c.timeSeconds.toFixed(1)}s`}
            className={[
              'absolute top-0 bottom-0 w-[3px] -translate-x-1/2 cursor-pointer transition-opacity hover:opacity-100',
              c.isAutoSuggested ? 'bg-amber-400/40 hover:bg-amber-400' : 'bg-emerald-400/70 hover:bg-emerald-400',
            ].join(' ')}
            style={{ left: `${left}%` }}
            aria-label={c.label}
          />
        )
      })}
    </div>
  )
}
