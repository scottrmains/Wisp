import { useState } from 'react'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, LoaderCircle } from 'lucide-react'
import { soulseek } from '../../api/soulseek'
import type { SoulseekTransfer } from '../../api/types'
import { transferPercent, transferState } from './transferState'

type Action = { type: 'cancel' | 'retry' | 'import'; transfer: SoulseekTransfer } | { type: 'clear'; transfer?: SoulseekTransfer }
const actionKey = ['soulseek-transfer-action']
const buttonClass = 'ui-button ui-button--small shrink-0'

/** Shared by the header transfers window and the search dialog. */
export function SoulseekTransferList({ transfers, error, full = false }: { transfers: SoulseekTransfer[]; error?: Error | null; full?: boolean }) {
  const qc = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const busy = useIsMutating({ mutationKey: actionKey }) > 0
  const action = useMutation({
    mutationKey: actionKey,
    mutationFn: async (request: Action) => {
      if (request.type === 'cancel') {
        await soulseek.cancelDownload(request.transfer)
        return null
      }
      if (request.type === 'retry' || request.type === 'import') {
        if (request.type === 'retry') await soulseek.retryDownload(request.transfer)
        else await soulseek.retryImport(request.transfer)
        return null
      }
      return soulseek.clearDownloads(request.transfer)
    },
    onMutate: async () => {
      setNotice(null)
      await qc.cancelQueries({ queryKey: ['soulseek-downloads'] })
    },
    onSuccess: async (result, request) => {
      if (result) {
        await qc.cancelQueries({ queryKey: ['soulseek-downloads'] })
        qc.setQueryData<SoulseekTransfer[]>(['soulseek-downloads'], old => old?.filter(t => !result.clearedIds.includes(t.id)))
        setNotice([
          `Cleared ${result.clearedIds.length} ${result.clearedIds.length === 1 ? 'entry' : 'entries'}. Downloaded files kept.`,
          result.skipped ? `${result.skipped} kept until library import succeeds. Check the import, then try Clear again.` : '',
          ...result.errors,
        ].filter(Boolean).join(' '))
      } else setNotice(request.type === 'cancel' ? 'Cancellation requested. Waiting for the transfer status to update.'
        : request.type === 'import' ? 'Library import queued.' : 'Download retry queued.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['soulseek-downloads'] }),
  })
  const finishedCount = transfers.filter(t => transferState(t.state).finished).length
  const visible = transfers.filter(t => {
    const state = transferState(t.state)
    return (filter === 'all' || (filter === 'active' && !state.finished) || (filter === 'completed' && state.succeeded)
      || (filter === 'failed' && state.finished && !state.succeeded))
      && `${t.filename} ${t.username}`.toLowerCase().includes(query.toLowerCase())
  }).sort((a, b) => (b.endedAt ?? b.startedAt ?? '').localeCompare(a.endedAt ?? a.startedAt ?? ''))

  return <section aria-label="Download transfers" className={full ? 'soulseek-transfers--full flex h-full min-h-0 flex-col' : ''}>
    {full && <div className="flex flex-wrap gap-3 border-b border-[var(--color-border)] px-5 py-3">
      <div role="group" aria-label="Filter downloads" className="flex flex-wrap gap-1">
        {(['all', 'active', 'completed', 'failed'] as const).map(value => <button key={value} aria-pressed={filter === value}
          onClick={() => setFilter(value)} className={`${buttonClass} ${filter === value ? 'bg-[var(--color-accent)]/15' : ''}`}>
          {value === 'failed' ? 'Failed / cancelled' : value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>
      <input aria-label="Filter downloads by file or user" placeholder="Filter files or users…" value={query} onChange={e => setQuery(e.target.value)}
        className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-xs" />
    </div>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
      <span className="text-[11px] text-[var(--color-muted)]">Clearing removes history, not files.</span>
      <button className={buttonClass} disabled={busy || !finishedCount}
        onClick={() => action.mutate({ type: 'clear' })}>
        {action.isPending && action.variables?.type === 'clear' && !action.variables.transfer ? 'Clearing…' : `Clear all finished (${finishedCount})`}
      </button>
    </div>
    {(action.error || error) && <p role="alert" className="break-words px-3 py-2 text-xs text-red-300">{action.error?.message ?? error?.message}</p>}
    {notice && <p role="status" className="break-words px-3 py-2 text-xs text-[var(--color-muted)]">{notice}</p>}
    <ul className={full ? 'min-h-0 flex-1 overflow-y-auto' : 'max-h-72 overflow-y-auto'}>
      {!transfers.length && <li className="px-3 py-4 text-xs text-[var(--color-muted)]">No transfers to show. Downloads you queue will appear here.</li>}
      {transfers.length > 0 && !visible.length && <li className="px-5 py-8 text-sm text-[var(--color-muted)]">No downloads match this filter.</li>}
      {visible.map(t => {
        const state = transferState(t.state)
        const fileName = t.filename.split(/[\\/]/).pop() ?? t.filename
        const pending = action.isPending && action.variables?.transfer?.id === t.id
        const tone = state.succeeded ? 'text-emerald-300' : state.failed ? 'text-red-300' : 'text-[var(--color-muted)]'
        const percent = transferPercent(t.percentage)
        return <li key={t.id} className="border-b border-[var(--color-border)]/40 px-3 py-2 last:border-0">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium" title={t.filename}>{fileName}</p>
              <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px]">
                <span className="truncate text-[var(--color-muted)]" title={t.username}>{t.username}</span>
                <span className={`inline-flex shrink-0 items-center gap-1 ${tone}`} title={t.state}>
                  {state.succeeded && <Check size={11} />}{state.label}
                </span>
                {!state.finished && <span className="ml-auto shrink-0 tabular-nums text-[var(--color-muted)]">{percent.toFixed(0)}%</span>}
                {full && !state.finished && (t.averageSpeed ?? 0) > 0 && <span className="shrink-0 tabular-nums">{Math.round(t.averageSpeed! / 1024)} KiB/s</span>}
                {full && t.placeInQueue != null && !state.finished && <span>Queue {t.placeInQueue}</span>}
              </div>
              {state.succeeded && <p className="mt-1 text-[11px] text-[var(--color-muted)]" role="status">
                {t.importStatus === 'Completed' ? 'Library scan complete' : t.importStatus === 'Running' || t.importStatus === 'Pending'
                  ? 'Importing into library…' : t.importStatus === 'Failed' || t.importStatus === 'Cancelled' ? 'Library import needs attention' : 'Waiting for library import'}
              </p>}
              {(t.error || t.importError) && <p className="mt-1 break-words text-[11px] text-red-300">{t.error ?? t.importError}</p>}
              {full && <p className="mt-1 truncate text-[11px] text-[var(--color-muted)]" title={t.filename}>{t.filename}</p>}
            </div>
            {full && state.finished && !state.succeeded && <button className={buttonClass} disabled={busy} aria-label={`Retry ${fileName}`}
              onClick={() => action.mutate({ type: 'retry', transfer: t })}>Retry</button>}
            {state.succeeded && ['Waiting', 'Failed', 'Cancelled'].includes(t.importStatus ?? 'Waiting') && <button className={buttonClass} disabled={busy}
              aria-label={`Retry import ${fileName}`} onClick={() => action.mutate({ type: 'import', transfer: t })}>Retry import</button>}
            <button className={buttonClass} disabled={busy}
              aria-label={`${state.finished ? 'Clear' : 'Cancel'} ${fileName} from ${t.username}`}
              onClick={() => action.mutate({ type: state.finished ? 'clear' : 'cancel', transfer: t })}>
              {pending ? <span className="inline-flex items-center gap-1"><LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" />{state.finished ? 'Clearing…' : 'Cancelling…'}</span> : state.finished ? 'Clear' : 'Cancel'}
            </button>
          </div>
          {!state.finished && <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--color-bg)]" role="progressbar" aria-label={`Download progress for ${fileName}`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full origin-left bg-[var(--color-accent)] transition-transform motion-reduce:transition-none" style={{ transform: `scaleX(${percent / 100})` }} />
          </div>}
        </li>
      })}
    </ul>
  </section>
}
