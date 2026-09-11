import { useRef, useState } from 'react'
import { Grip } from 'lucide-react'
import { bridge, bridgeAvailable } from '../../bridge'

export function ExternalFileDrag({ ids }: { ids: string[] }) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const available = bridgeAvailable() && /Windows/i.test(navigator.userAgent)
  const disabled = !available || busy || ids.length === 0
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <button type="button" disabled={disabled} draggable={false}
      aria-label={`Drag ${ids.length} audio files to rekordbox`}
      title={available ? 'Hold and drag this handle into a rekordbox playlist. Sends original audio files only; WISP cues are not transferred.' : 'Multi-file dragging requires the Windows desktop app.'}
      className="inline-flex touch-none select-none items-center gap-1.5 rounded border border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 px-3 py-1 text-xs disabled:opacity-50 enabled:cursor-grab active:cursor-grabbing"
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return
        e.preventDefault()
        start.current = { x: e.clientX, y: e.clientY }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (!start.current || inFlight.current || !(e.buttons & 1)) return
        if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) < 6) return
        start.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
        inFlight.current = true
        setBusy(true); setMessage(null); setFailed(false)
        void bridge.dragFiles(ids).then((result) => setMessage(result.dropAccepted
          ? `${result.fileCount} files handed to the destination. Check rekordbox for import results.` : 'Drag cancelled. Hold the handle and drag into rekordbox.'))
          .catch((err: Error) => { setFailed(true); setMessage(err.message) })
          .finally(() => { inFlight.current = false; setBusy(false) })
      }}
      onPointerUp={() => { start.current = null }} onPointerCancel={() => { start.current = null }} onLostPointerCapture={() => { start.current = null }}
      onClick={() => { if (!busy) { setFailed(false); setMessage('Hold this handle and drag into a rekordbox playlist. Files only—not WISP cues or playlist metadata.') } }}>
      <Grip size={13} /> {busy ? 'Dragging files…' : `Drag ${ids.length} files to rekordbox`}
    </button>
    <span className="text-[11px] text-[var(--color-muted)]">Audio files only · no WISP cues</span>
    {message && <><span role={failed ? 'alert' : 'status'} className={`max-w-xl break-words text-xs ${failed ? 'text-red-300' : 'text-[var(--color-muted)]'}`}>{message}</span>
      <button onClick={() => setMessage(null)} aria-label="Dismiss file drag message" className="px-1 text-xs text-[var(--color-muted)]">×</button></>}
  </div>
}
