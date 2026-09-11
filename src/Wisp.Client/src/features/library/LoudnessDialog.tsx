import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { loudness, safeGain, type LoudnessState } from '../../api/loudness'
import { bridge, bridgeAvailable } from '../../bridge'
import { useAudioFiles } from '../../audio/audioFiles'
import { usePlayer } from '../../state/player'

type Action = 'scan' | 'create' | 'original' | 'normalized'
const button = 'rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-40'

export function LoudnessDialog({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const operation = useRef<AbortController | null>(null)
  const qc = useQueryClient()
  const key = ['loudness-status', ids] as const
  const states = useQuery({ queryKey: key, queryFn: ({ signal }) => loudness.status(ids, signal), retry: false,
    refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false })
  const settings = useQuery({ queryKey: ['loudness-settings'], queryFn: loudness.settings, retry: false })
  const [selected, setSelected] = useState(() => new Set(ids))
  const [target, setTarget] = useState('-14')
  const [folder, setFolder] = useState<string | null>(null)
  const [limiting, setLimiting] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState('')
  const [page, setPage] = useState(0)
  const [preview, setPreview] = useState<{ id: string; version: 'original' | 'normalized' } | null>(null)
  const rows = states.data ?? []
  const musicFolder = folder ?? settings.data?.musicFolder ?? ''
  const targetValue = Number(target)
  const validTarget = target.trim() !== '' && Number.isFinite(targetValue) && targetValue >= -30 && targetValue <= -9
  const busy = pending !== null || picking
  const current = (row: LoudnessState) => !!row.analysis && !row.analysisStale && row.analysis.targetLufs === targetValue
  const eligible = rows.filter(row => selected.has(row.track.id) && current(row) && row.track.audioVersion !== 'normalized' && row.originalExists)
  const previewRow = rows.find(row => row.track.id === preview?.id)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current!
    el.showModal()
    return () => { operation.current?.abort(); el.close(); previous?.focus() }
  }, [])

  const run = async (action: Action, chosen: string[]) => {
    if (operation.current || !chosen.length) return
    const abort = new AbortController(); operation.current = abort
    setSummary(''); setPreview(null)
    let completed = 0, failed = 0
    try {
      for (const [index, id] of chosen.entries()) {
        if (abort.signal.aborted) break
        const row = qc.getQueryData<LoudnessState[]>(key)?.find(r => r.track.id === id)
        if (!row) continue
        setPending(`${action === 'scan' ? 'Scanning' : action === 'create' ? 'Creating and verifying' : 'Switching version'} ${index + 1} of ${chosen.length}: ${row.track.title ?? row.track.fileName}`)
        setErrors(old => { const next = { ...old }; delete next[id]; return next })
        try {
          const result = action === 'scan' ? await loudness.scan(id, targetValue, abort.signal)
            : action === 'create' ? await loudness.create(id, row.analysis!.id, musicFolder.trim(), limiting, abort.signal)
            : await loudness.switch(id, action, row.track.filePath)
          qc.setQueryData<LoudnessState[]>(key, old => old?.map(r => r.track.id === id ? result : r))
          if (action === 'original' || action === 'normalized') {
            const player = usePlayer.getState()
            if (player.trackId === id) { player._commands?.pause(); player._consumePendingPlay() }
            useAudioFiles.getState().refresh(id)
          }
          completed++
        } catch (error) {
          if (abort.signal.aborted) break
          failed++
          setErrors(old => ({ ...old, [id]: (error as Error).message }))
        }
      }
      setSummary(`${abort.signal.aborted ? 'Stopped. ' : ''}${completed} completed${failed ? ` · ${failed} failed (see rows below)` : ''}. ${action === 'create' ? 'Copies are saved; use “Use normalised” to activate them. Originals stay unchanged.' : ''}`)
      await qc.invalidateQueries({ predicate: q => q.queryKey[0] !== 'loudness-status' && q.queryKey[0] !== 'loudness-settings' })
      // Reconcile interrupted requests too: a commit may beat cancellation.
      await states.refetch()
    } finally { operation.current = null; setPending(null) }
  }

  const pickFolder = async () => {
    setPicking(true)
    try { const result = await bridge.pickFolder(); if (result.path) setFolder(result.path) }
    catch (error) { setSummary((error as Error).message) }
    finally { setPicking(false) }
  }

  return <dialog ref={dialog} aria-labelledby="loudness-title" onCancel={e => { e.preventDefault(); if (!busy) onClose() }}
    onKeyDown={e => e.stopPropagation()} className="m-auto max-h-[calc(100dvh-2rem)] w-[min(64rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-[var(--color-text)] shadow-2xl backdrop:bg-black/70">
    <h2 id="loudness-title" className="text-base font-semibold">Loudness & audio versions</h2>
    <p className="mt-2 text-sm text-[var(--color-muted)]">Scan the originals, review the gain, then create separate normalised copies. One WISP track keeps its cues and playlists. The active version is used for playback, file dragging and exports.</p>
    <div className="mt-4 flex flex-wrap items-end gap-3 text-sm">
      <label>Target LUFS<input aria-label="Target LUFS" type="number" min="-30" max="-9" step="1" value={target} disabled={busy}
        onChange={e => setTarget(e.target.value)} className="mt-1 block w-24 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2" /></label>
      <label className="min-w-0 flex-1">Main music folder<input aria-label="Main music folder" value={musicFolder} disabled={busy} onChange={e => setFolder(e.target.value)}
        placeholder="D:\Music" className="mt-1 block w-full min-w-40 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2" /></label>
      {bridgeAvailable() && <button disabled={busy} onClick={() => void pickFolder()} className={button}>Browse…</button>}
    </div>
    <p className="mt-2 break-all text-xs text-[var(--color-muted)]">Copies: {musicFolder ? `${musicFolder.replace(/[/\\]+$/, '')}/WISP Normalized/` : 'Choose your music folder'} · stereo 24-bit WAV, 44.1 kHz. Originals are never overwritten. WAV copies need more disk space.</p>
    <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={limiting} disabled={busy} onChange={e => setLimiting(e.target.checked)} />Allow limiting to reach target (changes dynamics). Off: constant gain capped to avoid clipping.</label>
    <p className="mt-1 text-xs text-[var(--color-muted)]">−14 LUFS is a starting point, not a DJ standard. Vinyl hiss/crackle also gets louder. Rescan after changing the target. Switching versions pauses playback and refreshes the waveform.</p>
    {(!validTarget || settings.error || settings.data?.available === false) && <p role="alert" className="mt-3 text-sm text-amber-300">{!validTarget ? 'Target must be between −30 and −9 LUFS.' : settings.error ? settings.error.message : 'FFmpeg is unavailable. Check its path in Settings.'}</p>}
    {states.isPending && <p role="status" className="mt-3">Loading audio versions…</p>}
    {states.error && <p role="alert" className="mt-3 text-red-300">{states.error.message} <button className="underline" onClick={() => void states.refetch()}>Retry</button></p>}
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button disabled={busy || !rows.length} onClick={() => setSelected(selected.size === rows.length ? new Set() : new Set(rows.map(r => r.track.id)))} className={button}>{selected.size === rows.length ? 'Deselect all' : 'Select all'}</button>
      <button disabled={busy || states.isFetching || !validTarget || !selected.size || !settings.data?.available} onClick={() => void run('scan', [...selected])} className={button}>Scan selected</button>
      <button disabled={busy || states.isFetching || !eligible.length || !musicFolder.trim() || !settings.data?.available} onClick={() => void run('create', eligible.map(r => r.track.id))}
        className={`${button} bg-[var(--color-accent)] text-white`}>Create {eligible.length} normalised {eligible.length === 1 ? 'copy' : 'copies'}</button>
      <span className="text-xs text-[var(--color-muted)]">{selected.size.toLocaleString()} selected · existing versions stay on disk</span>
      <button disabled={busy || !rows.some(r => selected.has(r.track.id) && r.normalizedExists && r.track.audioVersion !== 'normalized')}
        onClick={() => void run('normalized', rows.filter(r => selected.has(r.track.id) && r.normalizedExists && r.track.audioVersion !== 'normalized').map(r => r.track.id))} className={button}>Use normalised copies</button>
      <button disabled={busy || !rows.some(r => selected.has(r.track.id) && r.originalExists && r.track.audioVersion === 'normalized')}
        onClick={() => void run('original', rows.filter(r => selected.has(r.track.id) && r.originalExists && r.track.audioVersion === 'normalized').map(r => r.track.id))} className={button}>Use originals</button>
    </div>
    {pending && <p role="status" className="mt-3 break-words text-sm">{pending}</p>}
    {summary && <p role="status" className="mt-3 text-sm">{summary}</p>}
    <ul aria-label="Track loudness results" className="mt-3 max-h-80 space-y-3 overflow-y-auto">
      {rows.slice(page * 100, (page + 1) * 100).map(row => {
        const id = row.track.id, gain = safeGain(row), measured = row.analysis?.measurement
        const limited = gain !== null && row.analysis && gain < row.analysis.targetLufs - row.analysis.measurement.integratedLufs - 0.05
        return <li key={id} className="rounded border border-[var(--color-border)] p-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" aria-label={`Select ${row.track.title ?? row.track.fileName}`} checked={selected.has(id)} disabled={busy}
            onChange={e => setSelected(old => { const next = new Set(old); if (e.target.checked) next.add(id); else next.delete(id); return next })} />
            <span className="break-words">{row.track.artist ? `${row.track.artist} — ` : ''}{row.track.title ?? row.track.fileName}</span></label>
          <p className="mt-1 text-xs text-[var(--color-muted)]">Active: {row.track.audioVersion === 'normalized' ? 'Normalised' : 'Original'}{row.normalization ? ` · copy ${row.normalization.measurement.integratedLufs.toFixed(1)} LUFS · ${row.normalization.limited ? 'limited' : 'constant gain'}` : ''}</p>
          <p className="mt-2">{measured ? `${measured.integratedLufs.toFixed(1)} LUFS · peak ${measured.truePeakDb.toFixed(1)} dBTP · safe gain ${gain! >= 0 ? '+' : ''}${gain!.toFixed(1)} dB` : 'Not analysed yet'}</p>
          {row.analysis && <p className={`text-xs ${!current(row) || limited ? 'text-amber-300' : 'text-[var(--color-muted)]'}`}>{!current(row) ? 'Rescan required: target or original file changed.' : limited ? 'Peak-limited: safe mode will stay below target. Limiting is optional.' : Math.abs(row.analysis.targetLufs - measured!.integratedLufs) < 1 ? 'Already close to target.' : 'Loudness adjustment recommended.'}</p>}
          {!row.originalExists && <p className="text-xs text-amber-300">Original file is unavailable. Connect its drive to scan or switch back.</p>}
          {row.normalization && !row.normalizedExists && <p className="text-xs text-amber-300">Normalised copy is missing. Switch to the original and create it again.</p>}
          {errors[id] && <p role="alert" className="mt-2 break-words text-red-300">{errors[id]}</p>}
          <details className="mt-2 text-xs text-[var(--color-muted)]"><summary className="cursor-pointer">Version details</summary>
            <p className="mt-1 break-all">Original: {row.originalPath}</p>
            {row.normalization && <><p className="mt-1 break-all">Normalised: {row.normalization.outputPath}</p>
              <p className="mt-1">Created {new Date(row.normalization.createdAt).toLocaleString()} · target {row.normalization.targetLufs} LUFS · measured change {row.normalization.gainDb.toFixed(1)} dB</p></>}
          </details>
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={busy || !row.originalExists} onClick={() => setPreview({ id, version: 'original' })} className={button}>Preview original</button>
            {row.normalizedExists && <button disabled={busy} onClick={() => setPreview({ id, version: 'normalized' })} className={button}>Preview normalised</button>}
            {row.track.audioVersion === 'normalized'
              ? <button disabled={busy || !row.originalExists} onClick={() => void run('original', [id])} className={button}>Use original</button>
              : row.normalizedExists && <button disabled={busy} onClick={() => void run('normalized', [id])} className={button}>Use normalised</button>}
          </div>
        </li>
      })}
    </ul>
    {rows.length > 100 && <div className="mt-2 flex justify-end gap-2 text-sm"><button disabled={page === 0 || busy} onClick={() => setPage(p => p - 1)}>Previous results</button><span>{page + 1} / {Math.ceil(rows.length / 100)}</span><button disabled={(page + 1) * 100 >= rows.length || busy} onClick={() => setPage(p => p + 1)}>Next results</button></div>}
    {preview && previewRow && <div className="mt-3 rounded border border-[var(--color-border)] p-3 text-sm">
      <p className="break-words">Preview {preview.version === 'original' ? 'original' : 'normalised'}: {previewRow.track.title ?? previewRow.track.fileName} (active version unchanged)</p>
      <audio key={`${preview.id}:${preview.version}`} controls preload="none" className="mt-2 w-full" onPlay={() => usePlayer.getState()._commands?.pause()}
        onError={() => setErrors(old => ({ ...old, [preview.id]: 'Preview could not load. Check the file/drive and FFmpeg, then try again.' }))}
        src={`/api/tracks/${preview.id}/loudness/preview?version=${preview.version}`} />
    </div>}
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      {pending && <button onClick={() => operation.current?.abort()} className={button}>Stop processing</button>}
      <button disabled={busy} onClick={onClose} className={button}>Done</button>
    </div>
  </dialog>
}
