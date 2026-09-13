import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../../api/client'
import { bridge, bridgeAvailable, invoke } from '../../bridge'
import { alertDialog, confirmDialog } from '../../components/dialog'
import { usePlayer } from '../../state/player'
import { useCurrentPage } from '../../state/currentPage'

import { useRecorderStatus, statusKey, type Session, type Status } from './useRecorderStatus'
const sessionsKey = ['recording-sessions']
const button = 'min-h-11 rounded border border-[var(--color-border)] px-3 py-2 text-sm hover:bg-[var(--color-surface)] disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]'
const input = 'min-h-11 min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm'
const duration = (seconds: number) => `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`

export function MixRecordingIndicator() {
  const status = useRecorderStatus()
  const handlingClose = useRef(false)
  const setPage = useCurrentPage(s => s.setPage)
  useEffect(() => {
    if (!status.data?.closeRequested || handlingClose.current) return
    handlingClose.current = true
    void (async () => {
      try {
        const confirmed = await confirmDialog({ title: 'Recording is still active',
          message: 'Keep WISP open to continue, or stop and finish saving before closing.',
          confirmLabel: 'Stop and save', cancelLabel: 'Keep recording' })
        if (!confirmed) { await apiPost('/api/recordings/keep-recording'); return }
        const current = await apiGet<Status>('/api/recordings/status')
        if (current.busy && current.session) await apiPost(`/api/recordings/${current.session.id}/stop`)
        setPage('recordings')
        // Large-file hashing can take time. Keep the window open throughout.
        let state = await apiGet<Status>('/api/recordings/status')
        while (state.busy) {
          await new Promise(resolve => setTimeout(resolve, 500))
          state = await apiGet<Status>('/api/recordings/status')
        }
        if (state.session?.state !== 'Ready') throw new Error('The recording needs recovery. WISP has stayed open; check the recovery controls.')
        await invoke('closeAfterRecording')
      } catch (e) {
        await apiPost('/api/recordings/keep-recording').catch(() => {})
        await alertDialog({ title: 'WISP stayed open', message: e instanceof Error ? e.message : 'Check the recording before closing.', tone: 'error' })
      } finally { handlingClose.current = false }
    })()
    // A second native close can arrive between polls, leaving the boolean true
    // in both snapshots. Recheck every successful poll, not only boolean edges.
  }, [status.data?.closeRequested, status.dataUpdatedAt, setPage])
  if (!status.data?.busy) return null
  return <button className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-left text-sm text-red-400"
    onClick={() => setPage('recordings')}>● Mix recording · {duration(status.data.seconds)} · {status.data.session?.state} · View / stop</button>
}

export function MixRecorderPanel({ endpointId, inputTestBusy }: { endpointId: string; inputTestBusy: boolean }) {
  const qc = useQueryClient()
  const status = useRecorderStatus()
  const settings = useQuery({ queryKey: ['recording-settings'], queryFn: () => apiGet<{ folder: string | null }>('/api/recordings/settings') })
  const sessions = useQuery({ queryKey: sessionsKey, queryFn: () => apiGet<Session[]>('/api/recordings/'), refetchInterval: 2000 })
  const [title, setTitle] = useState('Practice mix')
  const [folder, setFolder] = useState<string | null>(null)
  const [previous, setPrevious] = useState<string | null>(null)
  const request = useRef<string | null>(null)
  const destination = folder ?? settings.data?.folder ?? ''
  const busy = status.data?.busy ?? false
  const refresh = () => { void qc.invalidateQueries({ queryKey: statusKey }); void qc.invalidateQueries({ queryKey: sessionsKey }) }
  const start = useMutation({ mutationFn: async () => {
    usePlayer.getState()._commands?.pause()
    document.querySelectorAll('audio').forEach(a => a.pause())
    request.current ??= crypto.randomUUID()
    return apiPost('/api/recordings/start', { requestId: request.current, title, folder: destination, endpointId, previousTakeId: previous })
  }, onSuccess: () => { request.current = null; refresh() } })
  const action = useMutation({ mutationFn: async ({ id, operation, body }: { id: string; operation: string; body?: unknown }) =>
    apiPost(`/api/recordings/${id}/${operation}`, body), onSuccess: refresh })
  const pick = async () => {
    try { const result = await bridge.pickFolder(destination); if (result.path) { setFolder(result.path); request.current = null } }
    catch (e) { await alertDialog({ title: 'Folder selection failed', message: String(e), tone: 'error' }) }
  }
  const remove = async (session: Session, deleteAudio: boolean) => {
    if (await confirmDialog({ title: deleteAudio ? 'Permanently delete managed audio?' : 'Remove this entry?',
      message: deleteAudio ? 'The managed master will be permanently deleted. A separately relinked file is never deleted. This cannot be undone.' : 'The audio files stay on disk. This entry will be hidden.', danger: deleteAudio,
      confirmLabel: deleteAudio ? 'Delete managed audio' : 'Remove entry' }))
      action.mutate({ id: session.id, operation: 'remove', body: { deleteAudio, confirmed: true } })
  }
  const relink = async (session: Session) => {
    try { const result = await bridge.pickAudioFile(); if (result.path) action.mutate({ id: session.id, operation: 'relink', body: { path: result.path } }) }
    catch (e) { await alertDialog({ title: 'Relink failed', message: String(e), tone: 'error' }) }
  }
  const error = start.error ?? action.error ?? status.error ?? sessions.error
  return <section aria-label="Full-length mix recording" className="space-y-4 border-y border-[var(--color-border)] py-5">
    <div><h2 className="text-xl font-semibold">Record a mix</h2>
      <p className="mt-1 text-sm text-[var(--color-muted)]">Lossless stereo master, saved directly to disk. No 30-second limit, live monitoring or automatic gain changes.</p></div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">Mix title<input className={input} value={title} maxLength={200} disabled={busy}
        onChange={e => { setTitle(e.target.value); request.current = null }} /></label>
      <label className="flex flex-col gap-1 text-sm">Recordings folder<input className={input} value={destination} disabled={busy}
        onChange={e => { setFolder(e.target.value); request.current = null }} /></label>
    </div>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy || !bridgeAvailable()} onClick={() => void pick()}>Choose recordings folder</button>
      <button className={`${button} bg-[var(--color-accent)] text-[var(--color-bg)]`} disabled={busy || inputTestBusy || start.isPending || !endpointId || !title.trim() || !destination || !status.data || status.isError}
        onClick={() => start.mutate()}>{start.isPending ? 'Starting…' : 'Start mix recording'}</button>
      <button className={button} disabled={!busy || action.isPending} onClick={() => action.mutate({ id: status.data!.session!.id, operation: 'stop' })}>Stop and save mix</button>
    </div>
    {previous && <p className="text-sm">This will be a new take linked to the previous recording. <button className="underline" disabled={busy} onClick={() => setPrevious(null)}>Clear link</button></p>}
    <p className="text-xs text-[var(--color-muted)]">Saved under WISP Recordings in your chosen folder, excluded from the track library. Uses the input selected above. Keep the computer awake. Files over 4 GB use RF64; use an RF64-capable player such as Audacity for those masters. MP3 export comes later.</p>
    {status.data?.session && <div className="space-y-2" aria-label="Mix recording status">
      <p role="status">{status.data.session.state} · {status.data.session.deviceName}</p>
      <p className="text-3xl tabular-nums">{duration(status.data.seconds)}</p>
      <p className="text-xs text-[var(--color-muted)]">Checkpointed: {duration(status.data.savedSeconds)}{status.data.remainingSeconds != null ? ` · Estimated space remaining: ${duration(status.data.remainingSeconds)}` : ''}</p>
      {busy && <div className="grid gap-2 sm:grid-cols-2">{(['leftPeak', 'rightPeak'] as const).map((key, index) => <label key={key} className="flex items-center gap-2 text-sm">
        {index === 0 ? 'L' : 'R'}<meter className="h-5 flex-1" aria-label={`Mix ${index === 0 ? 'left' : 'right'} input`} min={0} max={1} value={Math.min(1, status.data![key])} /></label>)}</div>}
      {status.data.clipped && <p className="text-sm text-red-400">Clipping detected. Lower the level feeding the input; recorded clipping cannot be repaired here.</p>}
      {status.data.session.issue && <p className="text-sm text-amber-300">{status.data.session.issue}</p>}
    </div>}
    {error && <p role="alert" className="text-sm text-red-400">{error.message}</p>}
    <details open={sessions.data?.some(s => s.state === 'Recoverable') ? true : undefined}>
      <summary className="cursor-pointer py-2 text-sm font-medium">Saved takes and recovery</summary>
      <p className="mb-3 text-xs text-[var(--color-muted)]">This is a basic session list. Waveforms, ratings and plan-linked review arrive in later phases.</p>
      {sessions.data?.map(s => <div key={s.id} className="space-y-2 border-t border-[var(--color-border)] py-3">
        <p className="break-words text-sm font-medium">{s.title} · {s.state}</p>
        <p className="break-all text-xs text-[var(--color-muted)]">{s.relinkedPath ?? s.directoryPath}</p>
        {s.issue && <p className="text-sm text-amber-300">{s.issue}</p>}
        {s.state === 'Ready' && s.audioBytes < 4294967200 && !busy && <audio key={s.relinkedPath ?? s.id} controls preload="none" className="w-full" aria-label={`Play ${s.title}`}
          src={`/api/recordings/${s.id}/audio`} onPlay={() => usePlayer.getState()._commands?.pause()} />}
        <div className="flex flex-wrap gap-2">
          {s.state === 'Recoverable' && <button className={button} disabled={busy || action.isPending} onClick={() => action.mutate({ id: s.id, operation: 'recover' })}>Recover saved audio</button>}
          <button className={button} disabled={busy} onClick={() => { setPrevious(s.id); setTitle(`${s.title.slice(0, 180)} — next take`); request.current = null }}>New linked take</button>
          {s.state === 'Ready' && <button className={button} disabled={busy || !bridgeAvailable()} onClick={() => void relink(s)}>Relink missing master</button>}
          <button className={button} disabled={busy || action.isPending} onClick={() => void remove(s, false)}>Remove entry</button>
          {s.state === 'Ready' && <button className={button} disabled={busy || action.isPending} onClick={() => void remove(s, true)}>Delete managed audio</button>}
        </div>
      </div>)}
    </details>
  </section>
}
