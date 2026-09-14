import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../../api/client'
import { bridge, bridgeAvailable } from '../../bridge'
import { useRecordingTracklist } from './useRecordingTracklist'
import { useMixExports, exportName } from './useMixExports'

interface ExportJob { id: string; recordingId: string; state: string; progress: number; error: string | null }
const button = 'wm-button'
const field = 'wm-field'
export function ExportActivity() {
  const [error, setError] = useState<string | null>(null)
  const job = useQuery({ queryKey: ['recording-export-job'], queryFn: async () => (await apiGet<ExportJob | null>('/api/recording-exports/job')) ?? null, refetchInterval: 1000 })
  if (!job.data?.id && !job.error) return null
  return <div aria-label="Mix export activity" className="flex flex-wrap items-center gap-3 border-y border-[var(--color-border)] py-3 text-sm">
    <span role="status">Mix export · {job.data?.state ?? 'Status unavailable'}</span>
    {job.data?.state === 'Running' && <><progress aria-label="Mix export progress" value={job.data.progress} max={1} /><button className={button} onClick={() => { setError(null); void apiPost(`/api/recording-exports/job/${job.data!.id}/cancel`).catch(e => setError(String(e))) }}>Cancel export</button></>}
    {(error || job.error || job.data?.error) && <p role="alert" className="w-full break-words text-red-400">{error ?? job.error?.message ?? job.data?.error}</p>}
  </div>
}
export function RecordingExportPanel({ id, ready, busy }: { id: string; ready: boolean; busy: boolean }) {
  const qc = useQueryClient(); const exports = useMixExports(id); const tracklist = useRecordingTracklist(id)
  const [folder, setFolder] = useState(''); const [format, setFormat] = useState('mp3'); const [include, setInclude] = useState(false)
  const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null)
  const attempt = useRef<{ key: string; requestId: string } | null>(null); const starting = useRef(false)
  const entries = tracklist.data?.entries ?? []
  const running = exports.data?.some(e => e.state === 'Running')
  const begin = async () => {
    if (starting.current) return
    starting.current = true; setPending(true); setError(null)
    const options = { folder: folder.trim(), format, includeTracklist: include, tracklistRevision: tracklist.data?.revision ?? 0 }
    const key = JSON.stringify(options)
    if (attempt.current?.key !== key) attempt.current = { key, requestId: crypto.randomUUID() }
    try {
      await apiPost(`/api/recording-exports/${id}`, { ...options, requestId: attempt.current.requestId })
      attempt.current = null
      await qc.invalidateQueries({ queryKey: ['recording-exports', id] }); await qc.invalidateQueries({ queryKey: ['recording-export-job'] })
    } catch (e) { setError(e instanceof Error ? e.message : 'Export could not start.') }
    finally { starting.current = false; setPending(false) }
  }
  return <section aria-label="Export finished mix" className="wm-export-panel">
    <h3>Make a listening copy</h3>
    <div className="space-y-3 py-3">
      <p className="text-sm text-[var(--color-muted)]">Create a separate audio file for listening or sharing. Your master, tracklist and review stay unchanged.</p>
      <div className="wm-export-options">
        <fieldset className="wm-format-options"><legend>Audio format</legend>{[{ value: 'mp3', label: 'MP3 · 320 kbps CBR', help: 'A smaller copy for sharing and everyday listening.' }, { value: 'wav', label: 'WAV · 24-bit PCM', help: 'Uncompressed audio at the recording’s sample rate.' }, { value: 'master', label: 'Original master · exact copy', help: 'A byte-identical copy of your source recording.' }].map(option => <label key={option.value}><input type="radio" name={`export-format-${id}`} value={option.value} checked={format === option.value} disabled={pending} onChange={() => setFormat(option.value)} /><span>{option.label}<span className="wm-subtitle">{option.help}</span></span></label>)}</fieldset>
        <div className="wm-export-destination">
        <label className="flex min-w-0 flex-[1_1_16rem] flex-col gap-1 text-sm">Export destination<input className={field} value={folder} disabled={pending} placeholder="Choose a folder or enter its full path" onChange={e => setFolder(e.target.value)} /></label>
        <button className={button} disabled={pending || !bridgeAvailable()} onClick={() => { void bridge.pickFolder(folder || undefined).then(result => { if (result.path) setFolder(result.path) }).catch(e => setError(String(e))) }}>Choose export folder</button>
        <p className="wm-subtitle">Your original recording stays untouched.</p></div>
      </div>
      <p className="text-xs text-[var(--color-muted)]">{format === 'mp3' ? 'Stereo 44.1 kHz MP3, encoded once from the master. No gain normalisation.' : format === 'wav' ? 'Stereo 24-bit integer PCM at the master’s sample rate. Converts the float master without improving source quality. Standard WAV is limited to 4 GiB.' : 'Byte-identical float WAV/RF64 master. Large RF64 files need a compatible external player; title and date are in the accompanying manifest.'} A new folder is created inside WISP Mix Exports. Existing files are never overwritten.</p>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={include} disabled={pending} onChange={e => setInclude(e.target.checked)} /> Include saved actual tracklist (.txt)</label>
      {include && <p className="text-xs text-[var(--color-muted)]">{entries.filter(e => e.played && e.startSeconds != null).length} timed · {entries.filter(e => e.played && e.startSeconds == null).length} clearly labelled untimed · {entries.filter(e => !e.played).length} drafts excluded. Entrance times are sorted chronologically; repeated tracks are kept. Comments and ratings are not exported.</p>}
      {(error || exports.error || (include && tracklist.error)) && <p role="alert" className="text-sm text-red-400">{error ?? exports.error?.message ?? tracklist.error?.message} <button className="underline" onClick={() => { void tracklist.refetch(); void exports.refetch() }}>Refresh export data</button></p>}
      <button className={`${button} bg-[var(--color-accent)]/20`} disabled={!ready || busy || running || pending || !folder.trim() || (include && !tracklist.data)} onClick={() => void begin()}>{pending ? 'Starting export…' : 'Create export'}</button>
      {!ready && <p className="text-xs text-amber-300">Save or recover the mix and reconnect its master before exporting.</p>}
      {busy && <p className="text-xs text-amber-300">Finish capture before exporting. Exporting blocks a new capture until it finishes or is cancelled.</p>}
      <div aria-label="Export history" className="space-y-2">
        {(exports.data ?? []).map(item => <div key={item.id} className="border-t border-[var(--color-border)] py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><span>{exportName(item.format)} · {item.state}{item.state === 'Ready' && !item.available ? ' · File missing or changed' : ''}{item.hasTracklist ? ' · Tracklist included' : ''}</span><span className="text-xs text-[var(--color-muted)]">{new Date(item.createdAt).toLocaleString()}</span></div>
          <p className="break-all py-1 text-xs text-[var(--color-muted)]">{item.directoryPath}</p>
          {item.error && <p className="break-words text-red-400">{item.error}</p>}
          {item.available && <button className={button} disabled={!bridgeAvailable()} onClick={() => { void bridge.openInExplorer(item.directoryPath).catch(e => setError(String(e))) }}>Show export folder</button>}
        </div>)}
      </div>
      <p className="text-xs text-[var(--color-muted)]">Back up both the audio folders and WISP’s database to preserve ratings, comments and Mix Plans. Unsaved browser drafts must be saved first.</p>
    </div>
  </section>
}
