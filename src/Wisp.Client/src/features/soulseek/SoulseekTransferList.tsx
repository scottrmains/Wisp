import { useState } from 'react'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, LoaderCircle } from 'lucide-react'
import { soulseek } from '../../api/soulseek'
import type { SoulseekTransfer } from '../../api/types'
import { transferPercent, transferState } from './transferState'

type Action = { type: 'cancel'; transfer: SoulseekTransfer } | { type: 'clear'; transfer?: SoulseekTransfer }
const actionKey = ['soulseek-transfer-action']
const buttonClass = 'min-h-8 shrink-0 rounded border border-[var(--color-border)] px-2 text-[11px] text-[var(--color-text)] hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40'

/** Shared by the header transfers window and the search dialog. */
export function SoulseekTransferList({ transfers, error }: { transfers: SoulseekTransfer[]; error?: Error | null }) {
  const qc = useQueryClient()
  const [notice, setNotice] = useState<string | null>(null)
  const busy = useIsMutating({ mutationKey: actionKey }) > 0
  const action = useMutation({
    mutationKey: actionKey,
    mutationFn: async (request: Action) => {
      if (request.type === 'cancel') {
        await soulseek.cancelDownload(request.transfer)
        return null
      }
      return soulseek.clearDownloads(request.transfer)
    },
    onMutate: async () => {
      setNotice(null)
      await qc.cancelQueries({ queryKey: ['soulseek-downloads'] })
    },
    onSuccess: async (result) => {
      if (result) {
        await qc.cancelQueries({ queryKey: ['soulseek-downloads'] })
        qc.setQueryData<SoulseekTransfer[]>(['soulseek-downloads'], old => old?.filter(t => !result.clearedIds.includes(t.id)))
        setNotice([
          `Cleared ${result.clearedIds.length} ${result.clearedIds.length === 1 ? 'entry' : 'entries'}. Downloaded files kept.`,
          result.skipped ? `${result.skipped} kept until library import succeeds. Check the import, then try Clear again.` : '',
          ...result.errors,
        ].filter(Boolean).join(' '))
      } else setNotice('Cancellation requested. Waiting for the transfer status to update.')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['soulseek-downloads'] }),
  })
  const finishedCount = transfers.filter(t => transferState(t.state).finished).length

  return <section aria-label="Download transfers">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
      <span className="text-[11px] text-[var(--color-muted)]">Clearing removes history, not files.</span>
      <button className={buttonClass} disabled={busy || !finishedCount}
        onClick={() => action.mutate({ type: 'clear' })}>
        {action.isPending && action.variables?.type === 'clear' && !action.variables.transfer ? 'Clearing…' : `Clear finished (${finishedCount})`}
      </button>
    </div>
    {(action.error || error) && <p role="alert" className="break-words px-3 py-2 text-xs text-red-300">{action.error?.message ?? error?.message}</p>}
    {notice && <p role="status" className="break-words px-3 py-2 text-xs text-[var(--color-muted)]">{notice}</p>}
    <ul className="max-h-72 overflow-y-auto">
      {!transfers.length && <li className="px-3 py-4 text-xs text-[var(--color-muted)]">No transfers to show. Downloads you queue will appear here.</li>}
      {transfers.map(t => {
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
              </div>
            </div>
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
