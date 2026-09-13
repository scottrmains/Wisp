import { useEffect, useRef } from 'react'

export interface Peaks { duration: number; levels: { secondsPerBucket: number; min: number[]; max: number[] }[] }
export function RecordingWaveform({ peaks, position, start, span, seek, markers }: {
  peaks: Peaks; position: number; start: number; span: number; seek: (seconds: number) => void; markers: { seconds: number }[]
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current!
    const draw = () => {
      const width = element.clientWidth; const height = element.clientHeight; const ratio = window.devicePixelRatio || 1
      element.width = width * ratio; element.height = height * ratio
      const ctx = element.getContext('2d')!; ctx.scale(ratio, ratio)
      const style = getComputedStyle(element)
      const level = [...peaks.levels].reverse().find(l => l.secondsPerBucket <= span / Math.max(1, width)) ?? peaks.levels[0]
      ctx.fillStyle = style.getPropertyValue('--color-surface'); ctx.fillRect(0, 0, width, height)
      ctx.strokeStyle = style.getPropertyValue('--color-border'); ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke()
      ctx.fillStyle = style.getPropertyValue('--color-accent')
      for (let x = 0; x < width; x++) {
        const from = Math.floor((start + x / width * span) / level.secondsPerBucket)
        const to = Math.max(from + 1, Math.ceil((start + (x + 1) / width * span) / level.secondsPerBucket))
        let min = 0, max = 0
        for (let i = from; i < Math.min(to, level.min.length); i++) { min = Math.min(min, level.min[i]); max = Math.max(max, level.max[i]) }
        ctx.fillRect(x, height / 2 - Math.min(1, max) * height * .44, 1, Math.max(1, (Math.min(1, max) - Math.max(-1, min)) * height * .44))
      }
      ctx.strokeStyle = style.getPropertyValue('--color-text'); ctx.lineWidth = 1.5
      for (const marker of markers) {
        const x = (marker.seconds - start) / span * width
        if (x >= 0 && x <= width) { ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, 24); ctx.stroke() }
      }
      const x = (position - start) / span * width
      if (x >= 0 && x <= width) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke() }
    }
    const observer = new ResizeObserver(draw); observer.observe(element); draw()
    return () => observer.disconnect()
  }, [peaks, position, start, span, markers])
  return <canvas ref={canvas} className="h-48 w-full cursor-crosshair rounded focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
    role="slider" aria-label="Recording waveform position" aria-valuemin={0} aria-valuemax={peaks.duration} aria-valuenow={position}
    aria-valuetext={`${Math.floor(position / 60)} minutes ${Math.floor(position % 60)} seconds`} tabIndex={0}
    onClick={e => { const rect = e.currentTarget.getBoundingClientRect(); seek(start + (e.clientX - rect.left) / rect.width * span) }}
    onKeyDown={e => { const next = e.key === 'ArrowRight' ? position + 5 : e.key === 'ArrowLeft' ? position - 5 : e.key === 'Home' ? 0 : e.key === 'End' ? peaks.duration : null
      if (next != null) { e.preventDefault(); e.stopPropagation(); seek(next) } }} />
}
