import { useEffect, useRef, useState } from 'react'
import { useSoulseekStatus } from '../../state/soulseekStatus'
import { useSoulseekTransfers } from './useSoulseekTransfers'

/// Compact pill in AppHeader showing aggregate Soulseek transfer status. Hidden
/// when nothing's in flight AND the user has dismissed the last completed batch.
/// Click to open a popover with per-transfer detail.
export function SoulseekStatusIndicator() {
  const { transfers, slskdConfigured } = useSoulseekTransfers()
  const dismissedAt = useSoulseekStatus((s) => s.dismissedAt)
  const dismiss = useSoulseekStatus((s) => s.dismiss)
  const [open, setOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Track whether we have any completed transfers we should still surface (briefly,
  // so the user gets confirmation that their downloads finished even if they weren't
  // looking at the panel).
  const inFlight = transfers.filter((t) => !t.state.includes('Completed'))
  const completed = transfers.filter((t) => t.state.includes('Completed'))
  const hasAny = transfers.length > 0
  const hasInFlight = inFlight.length > 0

  // Only show when there's something to show AND the user hasn't dismissed the
  // current batch. Dismissal is reset when fresh polling starts (in the store).
  const isDismissed = dismissedAt !== null && !hasInFlight
  const visible = slskdConfigured && hasAny && !isDismissed
  // Auto-fade the "all done" state after a short window so it doesn't linger forever.
  useEffect(() => {
    if (hasInFlight || !hasAny) return
    const t = setTimeout(() => dismiss(), 30_000)
    return () => clearTimeout(t)
  }, [hasInFlight, hasAny, dismiss])

  // Click-outside dismiss for the popover.
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!popoverRef.current) return
      if (!popoverRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointer, true)
    return () => window.removeEventListener('mousedown', onPointer, true)
  }, [open])

  if (!visible) return null

  // Aggregate percent across in-flight transfers. Done as a simple mean — a single
  // big track skews this slightly but it's good enough as a glanceable indicator.
  const aggregatePct = hasInFlight
    ? Math.round(inFlight.reduce((sum, t) => sum + (t.percentage || 0), 0) / inFlight.length)
    : 100

  const label = hasInFlight
    ? `📥 ${inFlight.length} downloading · ${aggregatePct}%`
    : `✓ ${completed.length} downloaded`

  const tone = hasInFlight
    ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/15 text-white'
    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={[
          'flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs tabular-nums transition-colors',
          tone,
        ].join(' ')}
        title="Soulseek transfers"
      >
        <span>{label}</span>
        {hasInFlight && (
          <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-white/10 sm:inline-block">
            <span
              className="block h-full bg-[var(--color-accent)] transition-all"
              style={{ width: `${aggregatePct}%` }}
            />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-[26rem] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
          <header className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
            <span className="text-xs font-semibold text-white">Soulseek transfers</span>
            <div className="flex items-center gap-1">
              {!hasInFlight && (
                <button
                  onClick={() => { dismiss(); setOpen(false) }}
                  className="text-[10px] uppercase tracking-wide text-[var(--color-muted)] hover:text-white"
                  title="Hide until next download"
                >
                  hide
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="text-base leading-none text-[var(--color-muted)] hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>
          </header>

          <ul className="max-h-80 overflow-auto">
            {transfers.length === 0 && (
              <li className="px-3 py-3 text-xs text-[var(--color-muted)]">No active transfers.</li>
            )}
            {transfers.map((t) => {
              const fileName = t.filename.split(/[\\/]/).pop() ?? t.filename
              const done = t.state.includes('Completed')
              const succeeded = t.state.includes('Succeeded')
              const cancelled = t.state.includes('Cancelled')
              const errored = t.state.includes('Errored') || t.state.includes('TimedOut')
              const tone = done && succeeded
                ? 'text-emerald-300'
                : done && (cancelled || errored)
                  ? 'text-red-300'
                  : 'text-[var(--color-muted)]'
              return (
                <li key={t.id} className="border-b border-[var(--color-border)]/40 px-3 py-2 text-xs">
                  <p className="truncate font-medium text-white" title={fileName}>{fileName}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[10px] text-[var(--color-muted)]">{t.username}</span>
                    <span className={`text-[10px] ${tone}`}>
                      {done ? (succeeded ? '✓ done' : cancelled ? 'cancelled' : errored ? 'failed' : t.state) : t.state}
                    </span>
                    {!done && (
                      <span className="ml-auto tabular-nums text-[10px] text-[var(--color-muted)]">
                        {t.percentage > 0 ? `${t.percentage.toFixed(0)}%` : '…'}
                      </span>
                    )}
                  </div>
                  {!done && (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--color-bg)]">
                      <div
                        className="h-full bg-[var(--color-accent)] transition-all"
                        style={{ width: `${Math.max(2, t.percentage || 0)}%` }}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
