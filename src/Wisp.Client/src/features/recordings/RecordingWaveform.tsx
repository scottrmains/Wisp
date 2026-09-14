import { useEffect, useRef } from 'react'
import { Bookmark, ListMusic, MessageSquare, Check } from 'lucide-react'

export interface Peaks {
  duration: number
  levels: { secondsPerBucket: number; min: number[]; max: number[] }[]
}
interface WaveMarker {
  seconds: number
  endSeconds?: number | null
  label?: string
  kind?: 'bookmark' | 'comment' | 'track'
  resolved?: boolean
}
export function RecordingWaveform({
  peaks,
  position,
  start,
  span,
  seek,
  markers,
  height = 146,
  disabled = false,
}: {
  peaks: Peaks
  position: number
  start: number
  span: number
  seek: (seconds: number) => void
  markers: WaveMarker[]
  height?: number
  disabled?: boolean
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // Peaks do not change on playback ticks; the playhead and markers are separate layers.
  useEffect(() => {
    const element = canvas.current!
    const draw = () => {
      const width = element.clientWidth,
        height = element.clientHeight,
        ratio = window.devicePixelRatio || 1
      if (!width || !height || !peaks.levels.length) return
      element.width = width * ratio
      element.height = height * ratio
      const ctx = element.getContext('2d')
      if (!ctx) return
      ctx.scale(ratio, ratio)
      const level =
        [...peaks.levels].reverse().find((l) => l.secondsPerBucket <= span / width) ??
        peaks.levels[0]
      ctx.clearRect(0, 0, width, height)
      ctx.fillStyle = getComputedStyle(element).getPropertyValue('--color-accent')
      ctx.globalAlpha = 0.72
      for (let x = 0; x < width; x++) {
        const from = Math.max(0, Math.floor((start + (x / width) * span) / level.secondsPerBucket))
        const to = Math.max(
          from + 1,
          Math.ceil((start + ((x + 1) / width) * span) / level.secondsPerBucket),
        )
        let min = 0,
          max = 0
        for (let i = from; i < Math.min(to, level.min.length); i++) {
          min = Math.min(min, level.min[i])
          max = Math.max(max, level.max[i])
        }
        ctx.fillRect(
          x,
          height / 2 - Math.min(1, max) * height * 0.4,
          1,
          Math.max(1, (Math.min(1, max) - Math.max(-1, min)) * height * 0.4),
        )
      }
    }
    const observer = new ResizeObserver(draw)
    observer.observe(element)
    draw()
    return () => observer.disconnect()
  }, [peaks, start, span])
  const percent = (seconds: number) => Math.max(0, Math.min(100, ((seconds - start) / span) * 100))
  return (
    <div className="wm-waveform" style={{ height }}>
      {markers
        .filter((m) => m.endSeconds != null && m.seconds < start + span && m.endSeconds > start)
        .map((m, i) => (
          <span
            aria-hidden="true"
            key={i}
            className={`wm-wave-range ${m.resolved ? 'is-resolved' : ''}`}
            style={{
              left: `${percent(m.seconds)}%`,
              width: `${percent(m.endSeconds!) - percent(m.seconds)}%`,
            }}
          />
        ))}
      <canvas
        ref={canvas}
        className="wm-wave-canvas"
        role="slider"
        aria-label="Recording waveform position"
        aria-disabled={disabled}
        aria-valuemin={0}
        aria-valuemax={peaks.duration}
        aria-valuenow={position}
        aria-valuetext={`${Math.floor(position / 60)} minutes ${Math.floor(position % 60)} seconds`}
        tabIndex={0}
        onClick={(e) => {
          if (disabled) return
          const rect = e.currentTarget.getBoundingClientRect()
          seek(start + ((e.clientX - rect.left) / rect.width) * span)
        }}
        onKeyDown={(e) => {
          if (disabled) return
          const next =
            e.key === 'ArrowRight'
              ? position + 5
              : e.key === 'ArrowLeft'
                ? position - 5
                : e.key === 'Home'
                  ? 0
                  : e.key === 'End'
                    ? peaks.duration
                    : null
          if (next != null) {
            e.preventDefault()
            e.stopPropagation()
            seek(next)
          }
        }}
      />
      {position >= start && position <= start + span && (
        <span
          aria-hidden="true"
          className="wm-wave-playhead"
          style={{ left: `${percent(position)}%` }}
        />
      )}
      <div className="wm-wave-pins">
        {markers
          .filter((m) => m.seconds >= start && m.seconds <= start + span)
          .map((m, i) => {
            const Icon =
              m.kind === 'track'
                ? ListMusic
                : m.kind === 'comment'
                  ? m.resolved
                    ? Check
                    : MessageSquare
                  : Bookmark
            const label = `${m.kind ?? 'Bookmark'} · ${Math.floor(m.seconds / 60)}:${String(Math.floor(m.seconds % 60)).padStart(2, '0')} · ${m.label ?? ''}${m.resolved ? ' · Resolved' : ''}`
            return (
              <button
                key={i}
                className={`wm-wave-pin ${m.kind === 'track' ? 'is-track' : ''}`}
                style={{ left: `${percent(m.seconds)}%` }}
                title={label}
                aria-label={label}
                disabled={disabled}
                onClick={() => seek(m.seconds)}
              >
                <Icon />
              </button>
            )
          })}
      </div>
    </div>
  )
}
