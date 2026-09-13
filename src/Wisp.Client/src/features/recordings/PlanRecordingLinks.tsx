import { useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import { useCurrentPage } from '../../state/currentPage'
import { useRecordingNavigation } from './useRecordingTracklist'

export function PlanRecordingLinks({ planId }: { planId: string }) {
  const takes = useQuery({ queryKey: ['plan-recordings', planId], queryFn: () => apiGet<{ id: string; title: string; state: string }[]>(`/api/recording-tracklists/plans/${planId}/recordings`) })
  return <div className="max-h-40 shrink-0 overflow-auto border-b border-[var(--color-border)] px-6 py-2 text-sm">
    <button className="min-h-11 rounded border border-[var(--color-border)] px-3 hover:bg-[var(--color-surface)]" onClick={() => { useRecordingNavigation.getState().prepare(planId); useCurrentPage.getState().setPage('recordings') }}>Record this plan</button>
    <span className="ml-3 text-xs text-[var(--color-muted)]">Opens setup; recording starts only when you choose Start.</span>
    {takes.error && <p role="alert" className="text-red-400">Could not load linked recordings. <button className="underline" onClick={() => void takes.refetch()}>Retry</button></p>}
    {!!takes.data?.length && <details><summary className="cursor-pointer py-2">Recordings with snapshots of this plan ({takes.data.length})</summary><div className="flex flex-wrap gap-2">{takes.data.map(t => <button key={t.id} className="min-h-11 break-words px-2 text-left hover:underline" onClick={() => { useRecordingNavigation.getState().select(t.id); useCurrentPage.getState().setPage('recordings') }}>{t.title} · {t.state}</button>)}</div></details>}
  </div>
}
