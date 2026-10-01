import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Sparkles, type LucideIcon } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { playlists as playlistsApi } from '../../api/playlists'
import type { MixPlan } from '../../api/types'
import { formatBpm } from '../library/format'
import { computePlanSummary, formatPlanDuration } from './summary'
import { CdjExportButton } from '../usb/CdjExportButton'

interface Props {
  plan: MixPlan
  onRename?: (name: string) => void
  /// Update the recommendation scope. `null` clears it.
  onScopeChange?: (playlistId: string | null) => void
  onRecommend?: () => void
  recommendationsOpen?: boolean
  /// Compact version drops the secondary stats row so it fits inside the dock.
  compact?: boolean
  leadingControl?: ReactNode
}

export function PlanHeader({
  plan,
  onRename,
  onScopeChange,
  compact,
  onRecommend,
  recommendationsOpen,
  leadingControl,
}: Props) {
  const summary = computePlanSummary(plan)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(plan.name)
  const playlistList = useQuery({
    queryKey: ['playlists'],
    queryFn: () => playlistsApi.list(),
    staleTime: 30_000,
    enabled: !!onScopeChange,
  })

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
    <div className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {leadingControl}
          {editing && onRename ? (
            <input
              aria-label="Mix plan name"
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
              aria-label={onRename ? `Rename ${plan.name}` : undefined}
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
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
          <Stat label={`${summary.trackCount} tracks`} />
          <Stat label={formatPlanDuration(summary.estimatedDurationSeconds)} />
          {summary.avgBpm !== null && <Stat label={`${formatBpm(summary.avgBpm)} avg BPM`} />}
          {summary.firstEnergy !== null && summary.lastEnergy !== null && (
            <Stat
              label={`E${summary.firstEnergy} → E${summary.lastEnergy}`}
              tone={
                summary.lastEnergy > summary.firstEnergy
                  ? 'up'
                  : summary.lastEnergy < summary.firstEnergy
                    ? 'down'
                    : 'flat'
              }
            />
          )}
          {summary.warnings.length > 0 && (
            <Stat
              icon={AlertTriangle}
              label={`${summary.warnings.length} warning${summary.warnings.length === 1 ? '' : 's'}`}
              tone="warn"
              title={summary.warnings.map((w) => w.message).join('\n')}
            />
          )}
          {!compact && (
            <CdjExportButton
              source="mix-plan"
              sourceId={plan.id}
              sourceName={plan.name}
              disabled={plan.tracks.length === 0}
            />
          )}
        </div>
      </div>

      {!compact && plan.notes && (
        <p className="mt-2 text-xs text-[var(--color-muted)]">{plan.notes}</p>
      )}

      {!compact && onScopeChange && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--color-muted)]">Recommend from:</span>
          <select
            aria-label="Recommendation playlist"
            value={plan.recommendationScopePlaylistId ?? ''}
            onChange={(e) => onScopeChange(e.target.value || null)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 text-xs"
          >
            <option value="">All tracks</option>
            {(playlistList.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.trackCount})
              </option>
            ))}
          </select>
          {onRecommend && (
            <Button
              small
              onClick={onRecommend}
              disabled={!plan.tracks.length}
              aria-expanded={!!recommendationsOpen}
              aria-controls="plan-recommendations"
              tooltip={
                plan.tracks.length
                  ? 'Audition and add tracks that fit the end of your plan'
                  : 'Add your first track to find compatible next tracks'
              }
            >
              <Sparkles size={14} /> Find next tracks
            </Button>
          )}
          {!plan.tracks.length && (
            <span className="text-[var(--color-muted)]">
              Add a first track to start recommendations.
            </span>
          )}
          {playlistList.error && (
            <span role="alert">
              Could not load playlists.{' '}
              <button onClick={() => void playlistList.refetch()}>Retry playlists</button>
            </span>
          )}
          {plan.recommendationScopePlaylistId && (
            <span className="text-[10px] text-[var(--color-muted)]">
              Suggestions use this playlist only
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  tone,
  title,
  icon: Icon,
}: {
  label: string
  tone?: 'up' | 'down' | 'flat' | 'warn'
  title?: string
  icon?: LucideIcon
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
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${cls}`}
      title={title}
    >
      {Icon && <Icon size={11} strokeWidth={1.75} />}
      {label}
    </span>
  )
}
