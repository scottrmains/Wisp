import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { mixPlans } from '../../api/mixPlans'
import type { MixPlanTrack, SuggestedRoute, Track } from '../../api/types'
import { formatBpm } from '../library/format'

interface Props {
  planId: string
  fromMpt: MixPlanTrack
  toMpt: MixPlanTrack
  onClose: () => void
  /// Called once the user picks a route — parent should add each track to the plan
  /// after the `from` anchor in order. The dialog closes itself once this returns.
  onAccept: (tracks: Track[]) => Promise<void> | void
}

/// Asks the server for candidate filler routes between two anchored cards
/// and lets the user pick one. Default gap is 2 fillers; user can step it 1..6.
export function SuggestRouteDialog({ planId, fromMpt, toMpt, onClose, onAccept }: Props) {
  const [gap, setGap] = useState(2)
  const [routes, setRoutes] = useState<SuggestedRoute[]>([])

  const suggest = useMutation({
    mutationFn: (g: number) => mixPlans.suggestRoute(planId, fromMpt.id, toMpt.id, g),
    onSuccess: setRoutes,
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex items-start justify-between border-b border-[var(--color-border)] px-5 py-3">
          <div>
            <h2 className="text-base font-semibold">Suggest fillers</h2>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              Bridge between
              <strong className="ml-1 text-white">{fromMpt.track.title ?? fromMpt.track.fileName}</strong>
              <span className="mx-1">→</span>
              <strong className="text-white">{toMpt.track.title ?? toMpt.track.fileName}</strong>
            </p>
          </div>
          <button onClick={onClose} className="text-xl leading-none text-[var(--color-muted)] hover:text-white">×</button>
        </header>

        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-5 py-2 text-xs">
          <label className="text-[var(--color-muted)]">Fillers between anchors</label>
          <input
            type="number"
            min={1}
            max={6}
            value={gap}
            onChange={(e) => setGap(Math.max(1, Math.min(6, Number(e.target.value) || 1)))}
            className="w-14 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1 py-0.5 text-xs"
          />
          <button
            onClick={() => suggest.mutate(gap)}
            disabled={suggest.isPending}
            className="rounded bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {suggest.isPending ? 'Searching…' : 'Suggest routes'}
          </button>
          {suggest.isError && (
            <span className="text-red-400">{(suggest.error as Error).message}</span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          {!suggest.isPending && routes.length === 0 && !suggest.data && (
            <p className="px-2 py-4 text-sm text-[var(--color-muted)]">
              Click <strong>Suggest routes</strong> to fetch candidates. Wisp ranks routes by transition score
              and excludes archived tracks, blocked pairs, and tracks already in this plan.
            </p>
          )}
          {!suggest.isPending && suggest.data && routes.length === 0 && (
            <p className="px-2 py-4 text-sm text-[var(--color-muted)]">
              No clean route between these anchors at gap {gap}. Try a different gap, relax the anchors,
              or add more candidates to your library.
            </p>
          )}

          <ul className="space-y-2">
            {routes.map((r, i) => (
              <RouteRow
                key={i}
                route={r}
                index={i + 1}
                onAccept={async () => {
                  await onAccept(r.tracks)
                  onClose()
                }}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function RouteRow({
  route,
  index,
  onAccept,
}: {
  route: SuggestedRoute
  index: number
  onAccept: () => void
}) {
  return (
    <li className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">
          Route {index}
          <span className="ml-2 text-xs text-[var(--color-muted)]">
            score {route.totalScore} · {route.summary}
            {route.warningCount > 0 && (
              <span className="ml-1 text-amber-400" title={`${route.warningCount} rough transition${route.warningCount === 1 ? '' : 's'}`}>
                · ⚠ {route.warningCount}
              </span>
            )}
          </span>
        </div>
        <button
          onClick={onAccept}
          className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white"
        >
          Accept
        </button>
      </div>
      <ol className="space-y-1">
        {route.tracks.map((t, i) => (
          <li key={t.id} className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-2 text-xs">
            <span className="text-[var(--color-muted)] tabular-nums">{(i + 1).toString().padStart(2, '0')}</span>
            <span className="min-w-0 truncate" title={t.title ?? t.fileName}>
              <span className="text-[var(--color-muted)]">{t.artist ?? '?'}</span>
              <span className="mx-1">—</span>
              <span>{t.title ?? t.fileName}</span>
            </span>
            <span className="shrink-0 text-[var(--color-muted)]">
              {formatBpm(t.bpm)} · {t.musicalKey ?? '—'} · E{t.energy ?? '—'}
            </span>
          </li>
        ))}
      </ol>
    </li>
  )
}
