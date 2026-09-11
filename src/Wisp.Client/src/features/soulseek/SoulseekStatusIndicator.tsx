import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Download, X } from 'lucide-react'
import { useSoulseekTransfers } from './useSoulseekTransfers'
import { SoulseekTransferList } from './SoulseekTransferList'
import { transferPercent, transferState } from './transferState'

/** Keep history reachable even when no transfers are active or a batch is cleared. */
export function SoulseekStatusIndicator() {
  const { transfers, slskdConfigured, error, refresh } = useSoulseekTransfers()
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inFlight = transfers.filter(t => !transferState(t.state).finished)
  const succeeded = transfers.filter(t => transferState(t.state).succeeded)
  const failed = transfers.filter(t => transferState(t.state).failed)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() }
    }
    window.addEventListener('mousedown', onPointer, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointer, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!slskdConfigured) return null
  const percent = inFlight.length ? Math.round(inFlight.reduce((sum, t) => sum + transferPercent(t.percentage), 0) / inFlight.length) : 0
  const label = inFlight.length ? `${inFlight.length} active · ${percent}%`
    : failed.length ? `${failed.length} failed` : succeeded.length ? `${succeeded.length} downloaded` : 'Transfers'
  const Icon = inFlight.length ? Download : failed.length ? AlertTriangle : succeeded.length ? Check : Download
  const tone = inFlight.length ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15'
    : failed.length ? 'border-amber-500/40 text-amber-200' : 'border-[var(--color-border)] text-[var(--color-text)]'

  return <div className="relative" ref={popoverRef}>
    <button ref={triggerRef} onClick={() => { if (!open) void refresh(); setOpen(o => !o) }}
      className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${tone}`}
      title="Soulseek transfers" aria-label="Soulseek transfers" aria-expanded={open} aria-controls="soulseek-transfers-panel">
      <Icon size={12} strokeWidth={1.75} />{label}
    </button>
    {open && <div id="soulseek-transfers-panel" className="fixed right-4 top-12 z-50 mt-1 w-[30rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl lg:absolute lg:right-0 lg:top-full">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <span className="text-xs font-semibold">Soulseek transfers</span>
        <button onClick={() => { setOpen(false); triggerRef.current?.focus() }} aria-label="Close transfers"
          className="rounded p-2 text-[var(--color-muted)] hover:text-white focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"><X size={14} /></button>
      </header>
      <SoulseekTransferList transfers={transfers} error={error} />
    </div>}
  </div>
}
