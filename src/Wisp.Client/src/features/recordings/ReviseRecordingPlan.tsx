import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../../api/client'
import { useActivePlan } from '../../state/activePlan'
import { useCurrentPage } from '../../state/currentPage'
import { formatTrackStart, useRecordingTracklist } from './useRecordingTracklist'
import { useFeedbackDrafts, useRecordingFeedback, type RevisionPreview, type RevisionRequest, type RevisionSelection } from './useRecordingFeedback'

const button = 'min-h-11 rounded border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-surface)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]'
const field = 'min-h-11 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm'
const openPlan = (id: string) => { useActivePlan.getState().setActivePlanId(id); useCurrentPage.getState().setPage('mix-plans') }

export function ReviseRecordingPlan({ id, title }: { id: string; title: string }) {
  const list = useRecordingTracklist(id); const feedback = useRecordingFeedback(id); const qc = useQueryClient()
  const hasDraft = useFeedbackDrafts(s => !!s.drafts[id])
  const revisions = useQuery({ queryKey: ['recording-revisions', id], queryFn: () => apiGet<{ id: string; planName: string; exists: boolean }[]>(`/api/recording-feedback/${id}/revisions`) })
  const [source, setSource] = useState<'actual' | 'blueprint'>('actual'); const [snapshotId, setSnapshotId] = useState('')
  const [name, setName] = useState(`${title.slice(0, 175)} — next attempt`)
  const [mapping, setMapping] = useState<Record<string, RevisionSelection>>({})
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]); const [overall, setOverall] = useState(false); const [exclude, setExclude] = useState(false)
  const [matching, setMatching] = useState<string | null>(null); const [search, setSearch] = useState('')
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [preview, setPreview] = useState<{ result: RevisionPreview; request: RevisionRequest } | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [created, setCreated] = useState<string | null>(null)
  const library = useQuery({ queryKey: ['revision-track-search', search], queryFn: ({ signal }) => apiGet<{ id: string; artist: string; title: string }[]>('/api/recording-tracklists/library', { q: search }, signal), enabled: !!matching && search.trim().length > 1 })
  const snapshots = list.data?.snapshots ?? []; const chosen = snapshotId || list.data?.activeSnapshotId || snapshots[0]?.id || ''
  const actual = list.data?.entries ?? []; const drafts = actual.filter(e => !e.played).length
  const entries = source === 'actual' ? actual.filter(e => e.played) : snapshots.find(s => s.id === chosen)?.blueprint.entries ?? []
  const request: RevisionRequest = { requestId, name, source, snapshotId: source === 'blueprint' ? chosen || null : null,
    tracklistRevision: list.data?.revision ?? 0, feedbackRevision: feedback.data?.revision ?? 0,
    entries: entries.map(e => mapping[e.id] ?? { sourceEntryId: e.id, trackId: e.trackId, omit: false }), annotationIds: selectedNotes, includeOverallNotes: overall, excludeDrafts: exclude }
  const fresh = preview && JSON.stringify(request) === JSON.stringify(preview.request)
  const changed = () => { setPreview(null); setCreated(null); setError(null); setRequestId(crypto.randomUUID()) }
  const refresh = async () => { setPreview(null); setError(null); await list.refetch(); const result = await feedback.refetch(); if (result.data?.annotations) setSelectedNotes(keys => keys.filter(key => result.data!.annotations.some(a => a.id === key))) }
  const prepare = async () => {
    setBusy(true); setError(null); setPreview(null)
    try { setPreview({ result: await apiPost<RevisionPreview>(`/api/recording-feedback/${id}/preview`, request), request }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Preview failed.') }
    finally { setBusy(false) }
  }
  const create = async () => {
    if (!preview || !fresh || hasDraft) return
    setBusy(true); setError(null)
    try {
      const result = await apiPost<{ planId: string; exists: boolean }>(`/api/recording-feedback/${id}/revise`, { ...preview.request, previewToken: preview.result.token })
      if (!result.exists) { setError('This request already created a plan which has since been deleted. Change the new plan name and preview again to create another.'); return }
      setCreated(result.planId)
      await qc.invalidateQueries({ queryKey: ['mixPlans'] }); await qc.invalidateQueries({ queryKey: ['recording-revisions', id] })
    } catch (e) { setError(e instanceof Error ? e.message : 'Plan could not be created. Retry this request or refresh if the preview changed.') }
    finally { setBusy(false) }
  }
  return <details className="border-t border-[var(--color-border)] pt-3">
    <summary className="cursor-pointer py-3 font-medium">Create a revised Mix Plan</summary>
    <div className="space-y-4 pt-2">
      <p className="text-sm text-[var(--color-muted)]">Build a separate plan for your next attempt. Your original plan, take and feedback stay untouched. Only saved feedback can be selected.</p>
      {hasDraft && <p role="status" className="text-sm text-amber-300">Save or discard the feedback draft before previewing a revised plan.</p>}
      {(error || list.error || feedback.error) && <p role="alert" className="text-sm text-red-400">{error ?? list.error?.message ?? feedback.error?.message} <button className="underline" disabled={busy} onClick={() => void refresh()}>Refresh revision sources</button></p>}
      <fieldset disabled={busy} className="space-y-4">
        <label className="flex flex-col gap-1 text-sm">New plan name<input className={field} maxLength={200} value={name} onChange={e => { setName(e.target.value); changed() }} /></label>
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">Plan source<select className={field} value={source} onChange={e => { setSource(e.target.value as 'actual' | 'blueprint'); setMapping({}); setMatching(null); changed() }}><option value="actual">Confirmed actual tracklist</option><option value="blueprint" disabled={!snapshots.length}>Saved blueprint</option></select></label>
          {source === 'blueprint' && <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">Blueprint snapshot<select className={field} value={chosen} onChange={e => { setSnapshotId(e.target.value); setMapping({}); changed() }}>{snapshots.map(s => <option key={s.id} value={s.id}>{s.planName} · {new Date(s.takenAt).toLocaleString()}</option>)}</select></label>}
        </div>
        {source === 'actual' && drafts > 0 && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={exclude} onChange={e => { setExclude(e.target.checked); changed() }} />Exclude {drafts} unconfirmed draft entries. To include one, confirm it in the actual tracklist first.</label>}
        <ol className="space-y-2">{entries.map((e, i) => {
          const choice = mapping[e.id] ?? { sourceEntryId: e.id, trackId: e.trackId, omit: false }
          return <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] py-2 text-sm" aria-label={`Revision source entry ${i + 1}`}>
            <span className="min-w-0 break-words">{i + 1}. {e.artist} — {e.title} {choice.omit ? '· Omitted' : choice.trackId !== e.trackId ? '· Matched to another library track (shown in preview)' : !choice.trackId ? '· Needs library match or omission' : ''}</span>
            <div className="flex items-center gap-2"><label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={choice.omit} onChange={event => { setMapping({ ...mapping, [e.id]: { ...choice, omit: event.target.checked } }); changed() }} />Omit</label><button type="button" className={button} disabled={choice.omit} onClick={() => { setMatching(e.id); setSearch('') }}>Match library track</button></div>
          </li>
        })}</ol>
        {entries.length === 0 && <p className="text-sm">No eligible tracks. Confirm actual entries or choose a saved blueprint.</p>}
        {matching && <div className="space-y-2">
          <label className="flex flex-col gap-1 text-sm">Search library match<input className={field} value={search} onChange={e => setSearch(e.target.value)} /></label>
          <div className="max-h-48 overflow-auto">{library.error && <p role="alert">{library.error.message}</p>}{search.trim().length > 1 && library.data?.map(t => <button type="button" className={`${button} block w-full break-words text-left`} key={t.id} onClick={() => { setMapping({ ...mapping, [matching]: { sourceEntryId: matching, trackId: t.id, omit: false } }); setMatching(null); changed() }}>Use {t.artist} — {t.title}</button>)}</div>
          <button type="button" className={button} onClick={() => setMatching(null)}>Cancel matching</button>
        </div>}
        <h5 className="text-sm font-medium">Feedback to carry forward</h5>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={overall} onChange={e => { setOverall(e.target.checked); changed() }} />Include saved overall notes</label>
        {(feedback.data?.annotations ?? []).map(a => <label key={a.id} className="flex min-h-11 items-start gap-2 py-2 text-sm"><input type="checkbox" className="mt-1" checked={selectedNotes.includes(a.id)} onChange={e => { setSelectedNotes(e.target.checked ? [...selectedNotes, a.id] : selectedNotes.filter(key => key !== a.id)); changed() }} /><span className="min-w-0 break-words">{formatTrackStart(a.seconds)} · {a.text} · {a.resolved ? 'Resolved' : 'To revisit'}</span></label>)}
        <button type="button" className={button} disabled={busy || hasDraft || !name.trim() || list.isPending || feedback.isPending || !!list.error || !!feedback.error} onClick={() => void prepare()}>Preview revised plan</button>
      </fieldset>
      {preview && <section aria-label="Revised plan preview" className="space-y-3 border-y border-[var(--color-border)] py-4">
        <h5 className="font-medium">{preview.request.name} · {preview.result.tracks.length} tracks</h5>
        {preview.result.problems.map((p, i) => <p role="alert" key={i} className="text-sm text-red-400">{p}</p>)}
        {preview.result.warnings.map((w, i) => <p key={i} className="text-sm text-amber-300">{w}</p>)}
        {!fresh && <p role="status" className="text-sm text-amber-300">Sources changed. Preview again before creating.</p>}
        <ol className="list-inside list-decimal space-y-1 text-sm">{preview.result.tracks.map(t => <li key={t.sourceEntryId} className="break-words">{t.artist} — {t.title}{t.isAnchor && ' · Anchor'}{t.cueInSeconds != null && ` · Source cue ${formatTrackStart(t.cueInSeconds)}`}{t.cueOutSeconds != null && ` → ${formatTrackStart(t.cueOutSeconds)}`}</li>)}</ol>
        <details><summary className="cursor-pointer py-2 text-sm">Notes that will be copied</summary><p className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm">{preview.result.notes}</p></details>
        <button className={`${button} bg-[var(--color-accent)]/20`} disabled={busy || hasDraft || !fresh || preview.result.problems.length > 0 || !!created} onClick={() => void create()}>Create new Mix Plan</button>
      </section>}
      {created && <p role="status" className="text-sm">New plan created. <button className="min-h-11 underline" onClick={() => openPlan(created)}>Open revised plan</button></p>}
      {!!revisions.data?.length && <div className="space-y-2"><h5 className="text-sm font-medium">Previous revisions from this take</h5>{revisions.data.map(r => <button key={r.id} className={`${button} block break-words text-left`} disabled={!r.exists} onClick={() => openPlan(r.id)}>{r.planName}{!r.exists && ' · Plan deleted (lineage preserved)'}</button>)}</div>}
    </div>
  </details>
}
