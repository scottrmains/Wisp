import { useEffect, useState } from 'react'
import type { MixPlan } from '../../api/types'
import { formatBpm } from '../library/format'
import { computePlanSummary, formatPlanDuration } from './summary'

interface Props {
  plan: MixPlan
  onRename?: (name: string) => void
  /// Compact version drops the secondary stats row so it fits inside the dock.
  compact?: boolean
}

export function PlanHeader({ plan, onRename, compact }: Props) {
  const summary = computePlanSummary(plan)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(plan.name)

  useEffect(() => {
    setDraft(plan.name)
  }, [plan.name])

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== plan.name) onRename?.(trimmed)
    else setDraft(plan.name)
  }

  return (
    <div className="border-b border-[var(--color-border)] px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        {editing && onRename ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(plan.name)
                setEditing(false)
              }
            }}
            className="rounded border border-[var(--color-accent)] bg-[var(--color-bg)] px-2 py-0.5 text-base font-semibold focus:outline-none"
          />
        ) : (
          <button
            onClick={() => onRename && setEditing(true)}
            className={[
              'truncate text-left text-base font-semibold',
              onRename ? 'cursor-text hover:text-[var(--color-accent)]' : 'cursor-default',
            ].join(' ')}
            title={onRename ? 'Click to rename' : ''}
          >
            {plan.name}
          </button>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
          <Stat label={`${summary.trackCount} tracks`} />
          <Stat label={formatPlanDuration(summary.estimatedDurationSeconds)} />
          {summary.avgBpm !== null && <Stat label={`${formatBpm(summary.avgBpm)} avg BPM`} />}
          {summary.firstEnergy !== null && summary.lastEnergy !== null && (
            <Stat
              label={`E${summary.firstEnergy} → E${summary.lastEnergy}`}
              tone={summary.lastEnergy > summary.firstEnergy ? 'up' : summary.lastEnergy < summary.firstEnergy ? 'down' : 'flat'}
            />
          )}
          {summary.warnings.length > 0 && (
            <Stat
              label={`⚠ ${summary.warnings.length} warning${summary.warnings.length === 1 ? '' : 's'}`}
              tone="warn"
              title={summary.warnings.map((w) => w.message).join('\n')}
            />
          )}
        </div>
      </div>

      {!compact && plan.notes && (
        <p className="mt-2 text-xs text-[var(--color-muted)]">{plan.notes}</p>
      )}
    </div>
  )
}

function Stat({
  label,
  tone,
  title,
}: {
  label: string
  tone?: 'up' | 'down' | 'flat' | 'warn'
  title?: string
}) {
  const cls =
    tone === 'warn'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
      : tone === 'up'
        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
        : tone === 'down'
          ? 'border-sky-500/40 bg-sky-500/10 text-sky-200'
          : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-muted)]'
  return (
    <span className={`rounded-md border px-2 py-0.5 ${cls}`} title={title}>
      {label}
    </span>
  )
}
