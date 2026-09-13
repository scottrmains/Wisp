import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../../api/client'
import { bridge, bridgeAvailable } from '../../bridge'
import { usePlayer } from '../../state/player'
import { RecordingInputPage } from './RecordingInputPage'
import { RecordingWaveform, type Peaks } from './RecordingWaveform'
import { useRecorderStatus, type Session } from './useRecorderStatus'
import { RecordingTracklistPanel } from './RecordingTracklistPanel'
import { useRecordingNavigation, useRecordingTracklist } from './useRecordingTracklist'
import { RecordingFeedbackPanel } from './RecordingFeedbackPanel'
import { useDraftStorageWarning, useFeedbackDrafts, useRecordingFeedback } from './useRecordingFeedback'
import { ExportActivity, RecordingExportPanel } from './RecordingExportPanel'
import { useMixExports, exportName } from './useMixExports'

interface Mix { session: Session; rating: number | null; reviewStatus?: string; duration: number; missing: boolean }
interface Job { id: string; recordingId: string; kind: string; state: string; progress: number; error: string | null }
interface Marker { id: string; seconds: number; label: string }
interface Review { revision: number; rating: number | null; markers: Marker[] }
const button = 'min-h-11 rounded border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-surface)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]'
const field = 'min-h-11 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm'
const clock = (n: number) => `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`
const mixesKey = ['recording-workspace-mixes']

export function RecordingsWorkspace() {
  const qc = useQueryClient(); const recorder = useRecorderStatus()
  const mixes = useQuery({ queryKey: mixesKey, queryFn: () => apiGet<Mix[]>('/api/recording-workspace/mixes'), refetchInterval: 2000 })
  const job = useQuery({ queryKey: ['recording-workspace-job'], queryFn: async () => (await apiGet<Job | null>('/api/recording-workspace/job')) ?? null, refetchInterval: 1000 })
  const selected = useRecordingNavigation(s => s.selected)
  const setSelected = useRecordingNavigation(s => s.select)
  const setupRequested = useRecordingNavigation(s => s.setupRequested)
  const feedbackDrafts = useFeedbackDrafts(s => s.drafts)
  const draftStorageWarning = useDraftStorageWarning(s => s.warning)
  const [search, setSearch] = useState(''); const [sort, setSort] = useState('date')
  const [height, setHeight] = useState(190); const drag = useRef<{ y: number; height: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = job.data?.state === 'Running'
  const active = mixes.data?.find(m => m.session.id === selected) ?? mixes.data?.[0]
  const rows = (mixes.data ?? []).filter(m => m.session.title.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) =>
    sort === 'title' ? a.session.title.localeCompare(b.session.title) : sort === 'duration' ? b.duration - a.duration : sort === 'rating' ? (b.rating ?? 0) - (a.rating ?? 0) : b.session.startedAt.localeCompare(a.session.startedAt))
  const importMix = async () => {
    setError(null)
    try {
      const source = await bridge.pickAudioFile(); if (!source.path) return
      const destination = await bridge.pickFolder(); if (!destination.path) return
      const next = await apiPost<Job>('/api/recording-workspace/import', { requestId: crypto.randomUUID(), path: source.path, folder: destination.path })
      setSelected(next.recordingId); await qc.invalidateQueries({ queryKey: ['recording-workspace-job'] })
    } catch (e) { setError(e instanceof Error ? e.message : 'Import could not start.') }
  }
  return <div className="h-full overflow-auto p-4 sm:p-6">
    <div className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs uppercase tracking-widest text-[var(--color-muted)]">Capture / listen / refine</p><h1 className="mt-1 text-2xl font-semibold">Your mixes</h1></div>
        <button className={button} disabled={!!recorder.data?.busy || busy || !bridgeAvailable()} onClick={() => void importMix()}>Import a mix</button>
      </header>
      <p className="text-xs text-[var(--color-muted)]">Imports keep an exact managed source copy plus a 44.1 kHz stereo playback master. Your original file stays untouched.</p>
      <ExportActivity />
      {draftStorageWarning && <p role="alert" className="text-sm text-amber-300">{draftStorageWarning}</p>}
      {Object.keys(feedbackDrafts).length > 0 && <div className="flex flex-wrap items-center gap-2 text-xs text-amber-300" role="status">Local feedback drafts: {Object.keys(feedbackDrafts).map(id => <button className={button} key={id} onClick={() => setSelected(id)}>{mixes.data?.find(m => m.session.id === id)?.session.title ?? 'Unavailable mix'}{feedbackDrafts[id].error ? ' · Save failed' : feedbackDrafts[id].saving ? ' · Saving' : ' · Unsaved'}</button>)}</div>}
      {(error || mixes.error) && <p role="alert" className="text-sm text-red-400">{error ?? mixes.error?.message}</p>}
      {job.data?.id && <div className="flex flex-wrap items-center gap-3 text-sm" role="status">
        <span>{job.data.kind === 'import' ? 'Mix import' : 'Waveform'} · {job.data.state}</span>
        {busy && <><progress aria-label="Recording processing progress" value={job.data.progress} max={1} /><button className={button} onClick={() => { void apiPost(`/api/recording-workspace/job/${job.data!.id}/cancel`).catch(e => setError(String(e))) }}>Cancel processing</button></>}
        {job.data.error && <span className="text-red-400">{job.data.error}</span>}
      </div>}
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">Find a mix<input className={`${field} w-full`} value={search} onChange={e => setSearch(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm">Sort<select className={field} value={sort} onChange={e => setSort(e.target.value)}><option value="date">Newest first</option><option value="title">Title A–Z</option><option value="duration">Longest first</option><option value="rating">Highest rated</option></select></label>
      </div>
      <section aria-label="Mix history" className="overflow-auto border-y border-[var(--color-border)]" style={{ height }}>
        {mixes.isPending ? <p className="p-4 text-sm">Loading your mixes…</p> : rows.length === 0 ? <p className="p-4 text-sm text-[var(--color-muted)]">{search ? 'No mixes match your search.' : 'Your next practice starts here. Open recording setup below, or import an existing mix.'}</p> : rows.map(m => <button key={m.session.id}
          aria-pressed={active?.session.id === m.session.id} onClick={() => setSelected(m.session.id)}
          className={`flex min-h-14 w-full items-center justify-between gap-4 border-b border-[var(--color-border)] px-3 py-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] ${active?.session.id === m.session.id ? 'bg-[var(--color-accent)]/15' : 'hover:bg-[var(--color-surface)]'}`}>
          <span className="min-w-0"><span className="block truncate font-medium">{m.session.title}</span><span className="text-xs text-[var(--color-muted)]">{new Date(m.session.startedAt).toLocaleDateString()} · {m.missing ? 'Missing file' : m.session.state}</span></span>
          <span className="shrink-0 text-right tabular-nums">{clock(m.duration)}<span className="block text-xs text-[var(--color-muted)]">{m.rating ? `${m.rating} / 5` : 'Unrated'}{m.reviewStatus && ` · ${m.reviewStatus}`}</span></span>
        </button>)}
      </section>
      <div role="separator" aria-label="Resize mix history" aria-orientation="horizontal" aria-valuemin={90} aria-valuemax={450} aria-valuenow={height} tabIndex={0}
        className="flex h-3 cursor-row-resize touch-none items-center justify-center focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"
        onPointerDown={e => { if (e.button !== 0) return; drag.current = { y: e.clientY, height }; e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerMove={e => { if (drag.current) setHeight(Math.min(450, Math.max(90, drag.current.height + e.clientY - drag.current.y))) }}
        onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
        onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setHeight(Math.max(90, Math.min(450, height + (e.key === 'ArrowDown' ? 20 : -20)))) } }}><span className="h-0.5 w-16 bg-[var(--color-muted)]" /></div>
      {active && <MixPlayback key={active.session.id} mix={active} processing={!!busy} job={job.data ?? null} />}
      <details open={!mixes.data?.length || recorder.data?.busy || setupRequested ? true : undefined} onToggle={e => { if (!e.currentTarget.open) useRecordingNavigation.getState().closeSetupIntent() }} className="border-t border-[var(--color-border)] pt-3">
        <summary className="cursor-pointer py-2 text-sm font-medium">Recording setup and file management</summary>
        {busy && job.data?.kind === 'import' && <p className="text-sm text-amber-300">Finish or cancel importing before starting a recording.</p>}
        <RecordingInputPage />
      </details>
    </div>
  </div>
}

function MixPlayback({ mix, processing, job }: { mix: Mix; processing: boolean; job: Job | null }) {
  const id = mix.session.id; const audio = useRef<HTMLAudioElement>(null); const qc = useQueryClient(); const recorder = useRecorderStatus()
  const [position, setPosition] = useState(0); const [playing, setPlaying] = useState(false); const [volume, setVolume] = useState(.8)
  const [zoom, setZoom] = useState(1); const [start, setStart] = useState(0); const [preRoll, setPreRoll] = useState(3)
  const [loopStart, setLoopStart] = useState(0); const [loopEnd, setLoopEnd] = useState(mix.duration); const [loop, setLoop] = useState(false)
  const [label, setLabel] = useState(''); const [error, setError] = useState<string | null>(null)
  const review = useQuery({ queryKey: ['recording-review', id], queryFn: () => apiGet<Review>(`/api/recording-workspace/${id}/review`) })
  const tracklist = useRecordingTracklist(id)
  const feedback = useRecordingFeedback(id)
  const exports = useMixExports(id)
  const [playbackExport, setPlaybackExport] = useState('auto')
  const largeMaster = mix.session.audioBytes >= 4294967200
  const playableExports = (exports.data ?? []).filter(e => e.available && (e.format === 'mp3' || (e.format === 'wav' && e.outputBytes < 4294967200)))
  const derived = playbackExport === 'auto' ? (largeMaster ? playableExports.find(e => e.format === 'mp3') : undefined) : playableExports.find(e => e.id === playbackExport)
  const peaks = useQuery({ queryKey: ['recording-peaks', id], queryFn: async () => (await apiGet<Peaks | null>(`/api/recording-workspace/${id}/peaks`)) ?? null, enabled: mix.session.state === 'Ready' && !mix.missing,
    refetchInterval: processing ? 1000 : false })
  useEffect(() => { if (job?.recordingId === id && job.state === 'Ready') void qc.invalidateQueries({ queryKey: ['recording-peaks', id] }) }, [job?.recordingId, job?.state, id, qc])
  const save = useMutation({ mutationFn: (next: Review) => apiPost(`/api/recording-workspace/${id}/review`, next), onSuccess: () => { setLabel(''); void qc.invalidateQueries({ queryKey: ['recording-review', id] }); void qc.invalidateQueries({ queryKey: ['recording-feedback', id] }); void qc.invalidateQueries({ queryKey: mixesKey }) } })
  const live = recorder.data?.busy && recorder.data.session?.id === id
  const disabled = !!recorder.data?.busy || mix.session.state !== 'Ready' || (!derived && (mix.missing || largeMaster || playbackExport !== 'auto'))
  const span = Math.max(.01, mix.duration / zoom)
  const seek = (time: number) => { const value = Math.min(mix.duration, Math.max(0, time)); if (audio.current) audio.current.currentTime = value; setPosition(value) }
  const toggle = async () => { if (!audio.current || disabled) return; setError(null); if (audio.current.paused) { try { await audio.current.play() } catch { setError('Playback failed. Reconnect the recording drive or relink its master under file management.') } } else audio.current.pause() }
  useEffect(() => { if (recorder.data?.busy) audio.current?.pause() }, [recorder.data?.busy])
  useEffect(() => {
    const element = audio.current!
    const otherPlay = (event: Event) => { if (event.target !== element) element.pause() }
    document.addEventListener('play', otherPlay, true)
    const unsubscribe = usePlayer.subscribe(state => { if (state.isPlaying || state.pendingPlay) element.pause() })
    return () => { document.removeEventListener('play', otherPlay, true); unsubscribe(); element.pause() }
  }, [])
  const mark = () => { if (!review.data) return; save.mutate({ ...review.data, markers: [...review.data.markers, { id: crypto.randomUUID(), seconds: live ? recorder.data!.seconds : position, label: label.trim() || 'Review this moment' }] }) }
  return <section aria-label="Mix playback" className="space-y-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="min-w-0 break-words text-xl font-semibold">{mix.session.title}</h2><span className="tabular-nums text-sm">{clock(position)} / {clock(mix.duration)}</span></div>
    {playableExports.length > 0 && <label className="flex flex-wrap items-center gap-2 text-sm">Playback source<select className={field} value={playbackExport} onChange={e => { audio.current?.pause(); setPlaying(false); setPosition(0); setPlaybackExport(e.target.value) }}><option value="auto">{largeMaster ? 'Automatic · verified MP3 export' : 'Original master'}</option>{playableExports.map(e => <option key={e.id} value={e.id}>{exportName(e.format)} · {new Date(e.createdAt).toLocaleString()}</option>)}</select></label>}
    <audio ref={audio} preload="none" src={disabled ? undefined : derived ? `/api/recording-exports/audio/${derived.id}` : `/api/recordings/${id}/audio`}
      onLoadedMetadata={() => { if (audio.current) audio.current.volume = volume }}
      onTimeUpdate={() => { const time = audio.current?.currentTime ?? 0; if (loop && loopEnd > loopStart && time >= loopEnd) seek(loopStart); else setPosition(time) }}
      onPlay={() => { usePlayer.getState()._commands?.pause(); document.querySelectorAll('audio').forEach(a => { if (a !== audio.current) a.pause() }); setPlaying(true) }}
      onPause={() => setPlaying(false)} onEnded={() => { if (loop && !disabled) { seek(loopStart); void audio.current?.play().catch(() => setError('Could not restart the loop.')) } else setPlaying(false) }}
      onError={() => setError(derived ? 'Export audio unavailable. Reconnect its drive or create a new export. Your original master is unchanged.' : 'Audio unavailable. Reconnect its drive or relink the original master under file management.')} />
    {peaks.data ? <><RecordingWaveform peaks={peaks.data} position={position} start={start} span={span} seek={seek} markers={[...(review.data?.markers ?? []), ...(feedback.data?.annotations ?? []).map(a => ({ seconds: a.seconds })), ...(tracklist.data?.entries ?? []).filter(e => e.played && e.startSeconds != null).map(e => ({ seconds: e.startSeconds! }))]} />
      <div className="flex justify-between text-xs tabular-nums text-[var(--color-muted)]"><span>{clock(start)}</span><span>{clock(Math.min(mix.duration, start + span))}</span></div></> : <div className="flex min-h-40 items-center justify-center border-y border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
      {mix.missing ? 'Master file is missing. Reconnect its drive or use Relink missing master below.' : mix.session.state !== 'Ready' ? `Recording is ${mix.session.state.toLowerCase()}. Playback becomes available after saving.` : 'Prepare the waveform to see the shape of your mix. Playback works while analysis is pending.'}</div>}
    {(error || save.error || peaks.error || review.error) && <p role="alert" className="text-sm text-red-400">{error ?? save.error?.message ?? peaks.error?.message ?? review.error?.message} {save.isError && <button className="underline" onClick={() => void review.refetch()}>Refresh review</button>}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button className={`${button} bg-[var(--color-accent)]/20`} disabled={disabled} onClick={() => void toggle()}>{playing ? 'Pause mix' : 'Play mix'}</button>
      <button className={button} disabled={disabled} onClick={() => seek(position - 10)}>Back 10s</button>
      <button className={button} disabled={disabled} onClick={() => seek(position + 10)}>Forward 10s</button>
      <label className="flex items-center gap-2 text-sm">Volume<input aria-label="Mix volume" type="range" min={0} max={1} step={.01} value={volume} onChange={e => { setVolume(+e.target.value); if (audio.current) audio.current.volume = +e.target.value }} /></label>
      <button className={button} disabled={processing || mix.missing || mix.session.state !== 'Ready'} onClick={() => { void apiPost(`/api/recording-workspace/${id}/peaks`).then(() => qc.invalidateQueries({ queryKey: ['recording-workspace-job'] })).catch(e => setError(String(e))) }}>{peaks.data ? 'Rebuild waveform' : 'Prepare waveform'}</button>
    </div>
    {largeMaster && <p className="text-sm text-amber-300">{derived ? 'Playing a verified export; the RF64 master is unchanged. Review times still refer to the original recording.' : 'This RF64 master is too large for the browser player. Create a 320 kbps MP3 under Export finished mix below to enable in-app playback, or use an RF64-capable external player.'}</p>}
    <p className="text-xs text-[var(--color-muted)]">Playback is disabled during capture to avoid feeding your mix back into the recording. No software monitoring.</p>
    <label className="flex items-center gap-3 text-sm">Position<input aria-label="Mix position" className="min-w-0 flex-1" type="range" min={0} max={mix.duration || 1} step={.1} value={position} disabled={disabled} onChange={e => seek(+e.target.value)} /></label>
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <label>Zoom <select className={field} value={zoom} onChange={e => { const value = +e.target.value; setZoom(value); setStart(Math.max(0, Math.min(position, mix.duration - mix.duration / value))) }}>{[1, 2, 4, 8, 16, 32].map(n => <option key={n} value={n}>{n}×</option>)}</select></label>
      <label className="flex min-w-0 flex-1 items-center gap-2">Visible window<input aria-label="Waveform window" className="min-w-0 flex-1" type="range" min={0} max={Math.max(0, mix.duration - span)} step={.1} value={start} onChange={e => setStart(+e.target.value)} /></label>
    </div>
    <details><summary className="cursor-pointer py-2 text-sm font-medium">Section loop</summary><div className="flex flex-wrap items-center gap-2 text-sm">
      <button className={button} onClick={() => { setLoopStart(position); if (position >= loopEnd) setLoop(false) }}>Set loop start · {clock(loopStart)}</button>
      <button className={button} onClick={() => { setLoopEnd(position); if (position <= loopStart) setLoop(false) }}>Set loop end · {clock(loopEnd)}</button>
      <label><input type="checkbox" checked={loop} disabled={disabled || loopEnd <= loopStart} onChange={e => setLoop(e.target.checked)} /> Loop section</label>
    </div></details>
    <details open><summary className="cursor-pointer py-2 text-sm font-medium">Review markers</summary>
      <div className="space-y-3 pt-2">
        <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>Marker pre-roll <select className={field} value={preRoll} onChange={e => setPreRoll(+e.target.value)}>{[0, 3, 5, 10].map(n => <option key={n} value={n}>{n}s</option>)}</select></label>{save.isPending && <span role="status">Saving review…</span>}{save.isSuccess && <span role="status">Review saved</span>}</div>
        <div className="flex flex-wrap gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 text-sm">Marker label<input className={`${field} w-full`} maxLength={200} value={label} onChange={e => setLabel(e.target.value)} /></label><button className={button} disabled={!review.data || save.isPending || (mix.session.state !== 'Ready' && !live)} onClick={mark}>Mark this moment{live ? ' (live)' : ''}</button></div>
        {review.data?.markers.length === 0 && <p className="text-xs text-[var(--color-muted)]">Quick bookmarks are separate from track starts. Use Feedback & next attempt for detailed comments and ranges.</p>}
        {review.data?.markers.map(marker => <div key={marker.id} className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] py-2 text-sm"><button className="min-w-0 break-words py-2 text-left hover:underline" onClick={() => seek(marker.seconds - preRoll)}>{clock(marker.seconds)} · {marker.label}</button><button className={button} disabled={save.isPending} aria-label={`Remove marker ${marker.label}`} onClick={() => save.mutate({ ...review.data!, markers: review.data!.markers.filter(m => m.id !== marker.id) })}>Remove</button></div>)}
      </div>
    </details>
    <RecordingExportPanel id={id} ready={mix.session.state === 'Ready' && !mix.missing} busy={!!recorder.data?.busy} />
    <RecordingTracklistPanel id={id} position={position} seek={seek} live={!!live && recorder.data?.session?.state === 'Recording'} canSetStart={!disabled} />
    <RecordingFeedbackPanel id={id} title={mix.session.title} position={position} duration={mix.duration} live={!!live && recorder.data?.session?.state === 'Recording'} canPlay={!disabled} seek={seek} loop={(from, to) => { const end = Math.min(mix.duration, to); const begin = Math.max(0, from); if (end > begin) { setLoopStart(begin); setLoopEnd(end); setLoop(true); seek(begin) } }} />
  </section>
}
