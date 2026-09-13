import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../../api/client'
import { mixPlans } from '../../api/mixPlans'
import { confirmDialog, promptDialog } from '../../components/dialog'
import { useActivePlan } from '../../state/activePlan'
import { useCurrentPage } from '../../state/currentPage'
import { formatTrackStart, parseTrackStart, tracklistKey, useRecordingTracklist, type PerformedEntry, type PlanSnapshot } from './useRecordingTracklist'

const button = 'min-h-11 rounded border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-surface)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]'
const field = 'min-h-11 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm'

function Snapshot({ snapshot }: { snapshot: PlanSnapshot }) {
  return <div className="space-y-2 text-sm">
    <p className="break-words font-medium">{snapshot.planName}</p>
    <p className="text-xs text-[var(--color-muted)]">{snapshot.timing} · {new Date(snapshot.takenAt).toLocaleString()} · Read-only snapshot</p>
    {snapshot.sourceExists ? <button className={button} onClick={() => { useActivePlan.getState().setActivePlanId(snapshot.sourcePlanId); useCurrentPage.getState().setPage('mix-plans') }}>Open current Mix Plan</button> : <p className="text-xs">Original plan deleted. This blueprint is preserved.</p>}
    {snapshot.blueprint.notes && <p className="whitespace-pre-wrap break-words">{snapshot.blueprint.notes}</p>}
    <ol className="list-inside list-decimal space-y-1">{snapshot.blueprint.entries.map(e => <li key={e.id} className="break-words">
      {e.artist && `${e.artist} — `}{e.title} <span className="text-xs text-[var(--color-muted)]">{e.bpm ? `${e.bpm} BPM · ` : ''}{e.musicalKey}{e.isAnchor ? ' · Anchor' : ''}
      {e.cueInSeconds != null ? ` · Source cue in ${formatTrackStart(e.cueInSeconds)}` : ''}{e.cueOutSeconds != null ? ` · out ${formatTrackStart(e.cueOutSeconds)}` : ''}</span>
      {e.transitionNotes && <p className="whitespace-pre-wrap pl-4 text-xs text-[var(--color-muted)]">{e.transitionNotes}</p>}
    </li>)}</ol>
  </div>
}

export function RecordingTracklistPanel({ id, position, seek, live, canSetStart }: {
  id: string; position: number; seek: (seconds: number) => void; live: boolean; canSetStart: boolean
}) {
  const query = useRecordingTracklist(id); const qc = useQueryClient()
  const plans = useQuery({ queryKey: ['mixPlans'], queryFn: mixPlans.list })
  const [planId, setPlanId] = useState(''); const [search, setSearch] = useState('')
  const [artist, setArtist] = useState(''); const [title, setTitle] = useState(''); const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(true)
  const library = useQuery({ queryKey: ['recording-track-search', search.trim()], queryFn: ({ signal }) => apiGet<{ id: string; artist: string; title: string }[]>('/api/recording-tracklists/library', { q: search.trim() }, signal), enabled: search.trim().length > 1 })
  const data = query.data; const entries = data?.entries ?? []; const snapshots = data?.snapshots ?? []
  const active = snapshots.find(s => s.id === data?.activeSnapshotId)
  const save = useMutation({
    mutationFn: ({ operation, body }: { operation: string; body?: object }) => apiPost(`/api/recording-tracklists/${id}/${operation}`, { revision: data?.revision ?? 0, ...body }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: tracklistKey(id) }); await qc.invalidateQueries({ queryKey: ['plan-recordings'] }) },
  })
  const busy = save.isPending || query.isFetching || !data || !!query.error || save.isError
  const update = (next: PerformedEntry[], liveEntryId?: string) => { setError(null); save.mutate({ operation: 'entries', body: { entries: next, liveEntryId } }) }
  const patch = (entry: PerformedEntry, changes: Partial<PerformedEntry>) => update(entries.map(e => e.id === entry.id ? { ...e, ...changes } : e))
  const move = (index: number, delta: number) => { const next = [...entries]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; update(next) }
  const add = async (trackId: string | null, name: string, performer: string) => {
    setError(null)
    try {
      await save.mutateAsync({ operation: 'entries', body: { entries: [...entries, { id: crypto.randomUUID(), trackId, artist: performer.trim(), title: name.trim(), played: false, startSeconds: null, blueprintEntryId: null }] } })
      if (!trackId) { setArtist(''); setTitle('') }
    } catch { /* Mutation error stays visible; preserve the input for retry. */ }
  }
  const editStart = async (entry: PerformedEntry) => {
    const value = await promptDialog({ title: 'Track start in this recording', message: 'Enter seconds, m:ss or h:mm:ss. This confirms the track was played; source-file cue points are not used.', defaultValue: entry.startSeconds == null ? '' : formatTrackStart(entry.startSeconds), confirmLabel: 'Save start', validate: value => parseTrackStart(value) == null ? 'Enter a valid time, such as 12:34.5.' : null })
    if (value == null) return
    const seconds = parseTrackStart(value)
    if (seconds == null) { setError('Enter a valid recording-relative time, such as 12:34.5.'); return }
    patch(entry, { startSeconds: seconds, played: true })
  }
  return <section aria-label="Recording tracklist" className="space-y-4 border-t border-[var(--color-border)] pt-4">
    <div><h3 className="font-semibold">Blueprint & actual tracklist</h3><p className="mt-1 text-xs text-[var(--color-muted)]">The plan is your starting point. The actual tracklist is what you confirm you played—nothing is detected automatically.</p></div>
    {(query.error || save.error || error || plans.error) && <p role="alert" className="text-sm text-red-400">{error ?? save.error?.message ?? query.error?.message ?? plans.error?.message} <button className="underline" onClick={() => { setError(null); save.reset(); void query.refetch() }}>Refresh tracklist</button></p>}
    {query.isPending && <p role="status" className="text-sm">Loading tracklist…</p>}
    <details><summary className="cursor-pointer py-2 text-sm font-medium">Saved blueprint · {active?.planName ?? 'No active plan'}</summary>
      <div className="space-y-3 pt-2">
        {active && <Snapshot snapshot={active} />}
        <p className="text-xs text-[var(--color-muted)]">Linking now saves the plan as it is today, not as it was when you recorded. Earlier snapshots and your actual tracklist stay intact.</p>
        <div className="flex flex-wrap items-center gap-2"><label className="flex min-w-0 items-center gap-2 text-sm">Link a Mix Plan<select className={`${field} max-w-full`} value={planId} disabled={busy} onChange={e => setPlanId(e.target.value)}><option value="">Choose a plan</option>{plans.data?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button className={button} disabled={busy || !planId} onClick={async () => { if (await confirmDialog({ title: 'Save a blueprint snapshot?', message: 'This captures the selected plan now. It does not change any actual tracks, timestamps or older snapshots.', confirmLabel: 'Save snapshot' })) save.mutate({ operation: 'link', body: { planId, snapshotId: crypto.randomUUID() } }) }}>Link current plan</button>
          {active && <button className={button} disabled={busy} onClick={async () => { if (await confirmDialog({ title: 'Unlink active blueprint?', message: 'Its saved snapshot remains in history. The actual tracklist stays unchanged.', confirmLabel: 'Unlink' })) save.mutate({ operation: 'unlink' }) }}>Unlink blueprint</button>}
        </div>
        {snapshots.filter(s => s.id !== active?.id).map(s => <details key={s.id}><summary className="cursor-pointer py-2 text-sm">Earlier snapshot · {s.planName} · {new Date(s.takenAt).toLocaleString()}</summary><Snapshot snapshot={s} /></details>)}
      </div>
    </details>
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">Actual tracklist · {entries.filter(e => e.played).length} confirmed / {entries.length} entries</h4>
      {active && <button className={button} disabled={busy || entries.length > 0} onClick={() => save.mutate({ operation: 'copy' })}>Copy blueprint as draft</button>}
    </div>
    {entries.length === 0 && <p className="text-sm text-[var(--color-muted)]">Add what you played below, or copy a linked blueprint into this empty list. Copied tracks start unconfirmed and untimed.</p>}
    {data?.timesDisagree && <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-amber-300">Track order differs from the timestamps. Your chosen order has been kept.<button className={button} disabled={busy} onClick={() => update([...entries].sort((a, b) => (a.startSeconds ?? Infinity) - (b.startSeconds ?? Infinity)))}>Order by start time</button></div>}
    <ol className="space-y-2">{entries.map((entry, index) => <li key={entry.id} aria-label={`Tracklist entry ${index + 1}`} className="space-y-2 border-t border-[var(--color-border)] py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="min-w-0 break-words text-sm font-medium">{index + 1}. {entry.artist && `${entry.artist} — `}{entry.title}</span>
        <span className="text-xs text-[var(--color-muted)]">{entry.played ? entry.startSeconds == null ? 'Played · Untimed' : `Played · ${formatTrackStart(entry.startSeconds)}` : 'Unconfirmed · Untimed'} · {entry.blueprintEntryId ? 'From saved blueprint' : 'Added independently'}{entry.trackId && data?.missingTrackIds?.includes(entry.trackId) ? ' · Library track missing (text preserved)' : ''}</span></div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={entry.played} disabled={busy} onChange={e => patch(entry, { played: e.target.checked, startSeconds: e.target.checked ? entry.startSeconds : null })} />Confirmed played</label>
        {live ? <button className={button} disabled={busy} onClick={() => update(entries, entry.id)}>Track started (live)</button> : <button className={button} disabled={busy || !canSetStart} onClick={() => patch(entry, { played: true, startSeconds: position })}>Set start here</button>}
        <button className={button} disabled={busy || live} onClick={() => void editStart(entry)}>Edit start time</button>
        {entry.startSeconds != null && <><button className={button} disabled={!canSetStart} onClick={() => seek(entry.startSeconds!)}>Go to start</button><button className={button} disabled={busy} onClick={() => patch(entry, { startSeconds: null })}>Clear time</button></>}
        <button className={button} aria-label={`Move entry ${index + 1} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button>
        <button className={button} aria-label={`Move entry ${index + 1} down`} disabled={busy || index === entries.length - 1} onClick={() => move(index, 1)}>↓</button>
        <button className={button} disabled={busy} onClick={async () => { if (await confirmDialog({ title: 'Remove actual tracklist entry?', message: `Remove “${entry.title}” from this recording's actual tracklist? The library track, audio and blueprint are untouched.`, confirmLabel: 'Remove entry' })) update(entries.filter(e => e.id !== entry.id)) }}>Remove tracklist entry</button>
      </div>
    </li>)}</ol>
    <details open={adding} onToggle={e => setAdding(e.currentTarget.open)}><summary className="cursor-pointer py-2 text-sm font-medium">Add actual tracks</summary>
      <div className="space-y-3 pt-2">
        <label className="flex flex-col gap-1 text-sm">Find library track<input className={field} value={search} onChange={e => setSearch(e.target.value)} /></label>
        {search.trim().length > 1 && <div className="max-h-52 space-y-1 overflow-auto">{library.isPending ? <p className="text-sm">Searching…</p> : library.error ? <p role="alert" className="text-sm text-red-400">{library.error.message}</p> : library.data?.length === 0 ? <p className="text-sm">No matches. Add artist/title manually below.</p> : library.data?.map(t => <button key={t.id} className={`${button} block w-full break-words text-left`} disabled={busy || entries.length >= 500} onClick={() => void add(t.id, t.title, t.artist)}>Add {t.artist && `${t.artist} — `}{t.title}</button>)}</div>}
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); if (!busy && title.trim()) void add(null, title, artist) }}>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">Manual artist<input className={field} maxLength={300} value={artist} onChange={e => setArtist(e.target.value)} /></label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">Manual title<input className={field} required maxLength={300} value={title} onChange={e => setTitle(e.target.value)} /></label>
          <button className={button} disabled={busy || !title.trim() || entries.length >= 500}>Add manual track</button>
        </form>
        <p className="text-xs text-[var(--color-muted)]">Repeated tracks are separate occurrences. Adding an entry does not confirm it was played or guess its start time. Unconfirming clears its time; clearing only the time keeps it confirmed.</p>
      </div>
    </details>
    {save.isPending && <p role="status" className="text-xs">Saving tracklist…</p>}{save.isSuccess && <p role="status" className="text-xs">Tracklist saved</p>}
  </section>
}
