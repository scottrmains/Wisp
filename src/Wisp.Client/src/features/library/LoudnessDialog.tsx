import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { loudness, loudnessPlan, type LoudnessState } from '../../api/loudness'
import { tracks } from '../../api/library'
import { ApiError } from '../../api/client'
import type { Track } from '../../api/types'
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
  const [mode, setMode] = useState<'reference' | 'custom'>('reference')
  const [boostOnly, setBoostOnly] = useState(true)
  const [referenceSearch, setReferenceSearch] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [referenceChoice, setReferenceChoice] = useState<Track | null>(null)
  const [reference, setReference] = useState<LoudnessState | null>(null)
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
  const targetValue = mode === 'reference' ? reference?.analysis?.measurement.integratedLufs ?? NaN : Number(target)
  const validTarget = (mode === 'reference' || target.trim() !== '') && Number.isFinite(targetValue) && targetValue >= -30 && targetValue <= -5
  const busy = pending !== null || picking
  const isReference = (row: LoudnessState) => mode === 'reference' && row.track.id === reference?.track.id
  const current = (row: LoudnessState) => validTarget && !!row.analysis && !row.analysisStale && Math.abs(row.analysis.targetLufs - targetValue) < 0.001
  const eligible = rows.filter(row => selected.has(row.track.id) && !isReference(row) && current(row) && row.track.audioVersion !== 'normalized' && row.originalExists && loudnessPlan(row, boostOnly, limiting)?.canCreate)
  const previewRow = rows.find(row => row.track.id === preview?.id) ?? (reference?.track.id === preview?.id ? reference : null)
  const search = useQuery({ queryKey: ['loudness-reference-search', searchTerm],
    queryFn: ({ signal }) => tracks.list({ search: searchTerm, size: 25 }, signal), enabled: mode === 'reference' && searchTerm.length >= 2, retry: false })
  const candidates = [...new Map([...(referenceChoice ? [referenceChoice] : []),
    ...(searchTerm.length >= 2 ? search.data?.items ?? [] : rows.slice(0, 100).map(r => r.track))].map(t => [t.id, t])).values()]
  useEffect(() => { const timer = setTimeout(() => setSearchTerm(referenceSearch.trim()), 250); return () => clearTimeout(timer) }, [referenceSearch])
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
      const work = chosen.filter(id => action !== 'scan' || mode !== 'reference' || id !== reference?.track.id)
      for (const [index, id] of work.entries()) {
        if (abort.signal.aborted) break
        const row = qc.getQueryData<LoudnessState[]>(key)?.find(r => r.track.id === id)
        if (!row) continue
        setPending(`${action === 'scan' ? 'Scanning' : action === 'create' ? 'Creating and verifying' : 'Switching version'} ${index + 1} of ${work.length}: ${row.track.title ?? row.track.fileName}`)
        setErrors(old => { const next = { ...old }; delete next[id]; return next })
        try {
          const result = action === 'scan' ? await loudness.scan(id, targetValue, abort.signal)
            : action === 'create' ? await loudness.create(id, row.analysis!.id, musicFolder.trim(), limiting, abort.signal,
              { boostOnly, ...(mode === 'reference' && reference?.analysis ? { referenceTrackId: reference.track.id, referenceAnalysisId: reference.analysis.id } : {}) })
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
          if (error instanceof ApiError && error.code === 'reference_stale') { setReference(null); break }
        }
      }
      setSummary(`${abort.signal.aborted ? 'Stopped. ' : ''}${completed} completed${failed ? ` · ${failed} failed (see rows below)` : ''}. ${action === 'create' ? completed > 0 ? 'Copies are saved; preview them before using “Use normalised”. Originals stay unchanged.' : 'No new copies saved. Existing audio stays unchanged.' : ''}`)
      await qc.invalidateQueries({ predicate: q => q.queryKey[0] !== 'loudness-status' && q.queryKey[0] !== 'loudness-settings' })
      // Reconcile interrupted requests too: a commit may beat cancellation.
      await states.refetch()
    } finally { operation.current = null; setPending(null) }
  }

  const measureReference = async () => {
    if (!referenceChoice || operation.current) return
    const abort = new AbortController(); operation.current = abort
    setPending(`Measuring reference original: ${referenceChoice.title ?? referenceChoice.fileName}`)
    setSummary(''); setReference(null); setPreview(null)
    try {
      // This scan measures the ORIGINAL, never an already-processed copy. Its
      // integrated input loudness becomes the target; -14 only configures the
      // measurement pass and does not change any audio.
      const result = await loudness.scan(referenceChoice.id, -14, abort.signal)
      setReference(result)
      qc.setQueryData<LoudnessState[]>(key, old => old?.map(r => r.track.id === result.track.id ? result : r))
      setSummary('Reference measured. Scan selected tracks to compare them. The reference stays unchanged.')
    } catch (error) { setSummary(abort.signal.aborted ? 'Reference scan stopped.' : `Could not measure reference: ${(error as Error).message}`) }
    finally { operation.current = null; setPending(null) }
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
    <p className="mt-2 text-sm text-[var(--color-muted)]">Bring quieter tracks closer to a track that sounds right on your decks. Review first, create separate copies, then listen before switching. Originals, cues and playlists stay intact.</p>
    <div className="mt-4 flex flex-wrap items-end gap-3 text-sm">
      <label>Match loudness to<select aria-label="Match loudness to" value={mode} disabled={busy} onChange={e => { setMode(e.target.value as typeof mode); setPreview(null) }} className="mt-1 block rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
        <option value="reference">A reference track</option><option value="custom">A custom LUFS target</option>
      </select></label>
      {mode === 'custom' && <label>Target LUFS<input aria-label="Target LUFS" type="number" min="-30" max="-5" step="any" value={target} disabled={busy}
        onChange={e => setTarget(e.target.value)} className="mt-1 block w-24 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2" /></label>}
    </div>
    {mode === 'reference' && <div className="mt-3 space-y-2 rounded border border-[var(--color-border)] p-3 text-sm">
      <p>Choose a reference from your selection, or search the whole library. WISP measures and previews its <strong>original file</strong>, even if a normalised copy is active.</p>
      <label className="block">Search library for reference<input aria-label="Search library for reference" value={referenceSearch} disabled={busy} onChange={e => setReferenceSearch(e.target.value)} placeholder="Artist or track title (at least 2 characters)" className="mt-1 block w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2" /></label>
      <div className="flex flex-wrap items-end gap-2"><label className="min-w-0 flex-1">Reference track<select aria-label="Reference track" value={referenceChoice?.id ?? ''} disabled={busy}
        onChange={e => { setReferenceChoice(candidates.find(t => t.id === e.target.value) ?? null); setReference(null); setPreview(null) }} className="mt-1 block w-full min-w-0 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
        <option value="">Choose a reference…</option>{candidates.map(t => <option key={t.id} value={t.id}>{t.artist ? `${t.artist} — ` : ''}{t.title ?? t.fileName}</option>)}
      </select></label><button className={button} disabled={busy || !referenceChoice || !settings.data?.available} onClick={() => void measureReference()}>Measure reference</button></div>
      {search.isFetching && <p role="status">Searching library…</p>}
      {search.error && <p role="alert">Reference search failed: {search.error.message} <button className="underline" onClick={() => void search.refetch()}>Retry</button></p>}
      {searchTerm.length >= 2 && search.data?.items.length === 0 && <p>No matching tracks. Try another title or artist.</p>}
      {reference?.analysis && <p className="break-words">Reference: {reference.track.title ?? reference.track.fileName} · original {targetValue.toFixed(2)} LUFS <button className="ml-2 underline" disabled={busy} onClick={() => setPreview({ id: reference.track.id, version: 'original' })}>Preview reference original</button></p>}
    </div>}
    <div className="mt-4 flex flex-wrap items-end gap-3 text-sm">
      <label className="min-w-0 flex-1">Main music folder<input aria-label="Main music folder" value={musicFolder} disabled={busy} onChange={e => setFolder(e.target.value)}
        placeholder="D:\Music" className="mt-1 block w-full min-w-40 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2" /></label>
      {bridgeAvailable() && <button disabled={busy} onClick={() => void pickFolder()} className={button}>Browse…</button>}
    </div>
    <p className="mt-2 break-all text-xs text-[var(--color-muted)]">Copies: {musicFolder ? `${musicFolder.replace(/[/\\]+$/, '')}/WISP Normalized/` : 'Choose your music folder'} · stereo 24-bit WAV, 44.1 kHz. Originals are never overwritten. WAV copies need more disk space.</p>
    <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={boostOnly} disabled={busy} onChange={e => setBoostOnly(e.target.checked)} />Only boost quieter tracks — never turn tracks down</label>
    {!boostOnly && <p className="mt-1 text-sm text-amber-300">Matching all tracks may reduce their volume, including to keep peaks below the safety ceiling. Review each change before creating copies.</p>}
    <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" checked={limiting} disabled={busy} onChange={e => setLimiting(e.target.checked)} />Allow limiting to reach target (changes dynamics). Off: only gain changes that avoid clipping.</label>
    <p className="mt-1 text-xs text-[var(--color-muted)]">Louder is not automatically better. Limiting can reduce punch; vinyl hiss/crackle also gets louder. Rescan after changing the reference or target. The active version is used for playback, dragging and exports.</p>
    {(settings.error || settings.data?.available === false) && <p role="alert" className="mt-3 text-sm text-amber-300">{settings.error ? settings.error.message : 'FFmpeg is unavailable. Check its path in Settings.'}</p>}
    {!validTarget && <p role="status" className="mt-3 text-sm text-amber-300">{mode === 'reference' && !reference ? 'Choose and measure a reference to begin, or select a custom target.' : 'Supported targets are −30 to −5 LUFS. Choose another reference or enter a custom target in this range.'}</p>}
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
        const id = row.track.id, plan = loudnessPlan(row, boostOnly, limiting), measured = row.analysis?.measurement
        return <li key={id} className="rounded border border-[var(--color-border)] p-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" aria-label={`Select ${row.track.title ?? row.track.fileName}`} checked={selected.has(id)} disabled={busy}
            onChange={e => setSelected(old => { const next = new Set(old); if (e.target.checked) next.add(id); else next.delete(id); return next })} />
            <span className="break-words">{row.track.artist ? `${row.track.artist} — ` : ''}{row.track.title ?? row.track.fileName}</span></label>
          <p className="mt-1 text-xs text-[var(--color-muted)]">Active: {row.track.audioVersion === 'normalized' ? 'Normalised' : 'Original'}{row.normalization ? ` · copy ${row.normalization.measurement.integratedLufs.toFixed(1)} LUFS · ${row.normalization.limited ? 'limited' : 'constant gain'}` : ''}</p>
          {row.normalization && validTarget && Math.abs(row.normalization.targetLufs - targetValue) > 0.01 && <p className="mt-1 text-xs text-amber-300">Saved copy uses a different target ({row.normalization.targetLufs.toFixed(1)} LUFS). Create a new copy to apply the current target; “Use normalised” activates the existing saved copy.</p>}
          <p className="mt-2">{measured ? `Original ${measured.integratedLufs.toFixed(1)} LUFS · peak ${measured.truePeakDb.toFixed(1)} dBTP` : 'Not analysed yet'}</p>
          {isReference(row) ? <p className="mt-1 text-sm">Reference track — leave unchanged.</p> : row.analysis && <p className={`mt-1 text-sm ${!current(row) || plan?.action === 'needs-limiting' || plan?.limited ? 'text-amber-300' : 'text-[var(--color-muted)]'}`}>
            {!current(row) ? 'Rescan required: choose a target/reference and scan this original.'
              : plan?.action === 'unchanged' ? boostOnly ? 'Leave unchanged — already loud enough or within 0.5 LUFS of target; no useful adjustment needed.' : 'Leave unchanged — these settings produce no useful gain change. If the track is still quiet, consider optional limiting.'
              : plan?.action === 'needs-limiting' ? 'Cannot boost safely without limiting. Leave unchanged, or enable limiting and preview the copy.'
              : plan?.limited ? `Needs limiting — aiming for ${targetValue.toFixed(1)} LUFS (${plan.requestedGainDb >= 0 ? '+' : ''}${plan.requestedGainDb.toFixed(1)} dB loudness change). Preview before using; dynamics will change.`
              : plan?.action === 'reduce' ? `Reduce by ${Math.abs(plan.gainDb).toFixed(1)} dB to match the target / protect peaks. Enable boost-only to leave it unchanged.`
              : `Boost safely by +${plan!.gainDb.toFixed(1)} dB → about ${(measured!.integratedLufs + plan!.gainDb).toFixed(1)} LUFS.${plan?.action === 'partial-boost' ? ' Peaks prevent reaching the target with gain alone. Optional limiting can bring it closer.' : ''}`}
          </p>}
          {current(row) && plan?.limited && plan.requestedGainDb > 6 && <p className="mt-1 text-xs text-amber-300">Large loudness increase: limiting may audibly flatten transients and raise noise. Consider a quieter reference.</p>}
          {!row.originalExists && <p className="text-xs text-amber-300">Original file is unavailable. Connect its drive to scan or switch back.</p>}
          {row.track.audioVersion === 'normalized' && <p className="text-xs text-[var(--color-muted)]">Switch to the original before creating another copy. The saved copy stays on disk.</p>}
          {row.normalization && !row.normalizedExists && <p className="text-xs text-amber-300">Normalised copy is missing. Switch to the original and create it again.</p>}
          {errors[id] && <p role="alert" className="mt-2 break-words text-red-300">{errors[id]}</p>}
          <details className="mt-2 text-xs text-[var(--color-muted)]"><summary className="cursor-pointer">Version details</summary>
            <p className="mt-1 break-all">Original: {row.originalPath}</p>
            {row.normalization && <><p className="mt-1 break-all">Normalised: {row.normalization.outputPath}</p>
              <p className="mt-1">Created {new Date(row.normalization.createdAt).toLocaleString()} · target {row.normalization.targetLufs} LUFS · measured change {row.normalization.gainDb.toFixed(1)} dB</p></>}
            {row.normalization?.referenceTitle && <p className="mt-1 break-words">Matched to reference original: {row.normalization.referenceTitle}</p>}
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
      {!rows.some(row => row.track.id === preview.id) && errors[preview.id] && <p role="alert" className="mt-2 text-red-300">{errors[preview.id]}</p>}
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
