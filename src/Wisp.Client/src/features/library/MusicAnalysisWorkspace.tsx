import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AudioLines, X } from 'lucide-react'
import {
  musicAnalysis,
  analysisDraft,
  analysisRunning,
  type AnalysisRow,
} from '../../api/musicAnalysis'
import { useMusicAnalysis } from '../../state/musicAnalysis'
import { Button, IconButton } from '../../components/ui/Button'
import './musicAnalysis.css'

type Draft = ReturnType<typeof analysisDraft>
export function MusicAnalysisWorkspace() {
  const state = useMusicAnalysis()
  const qc = useQueryClient()
  const dialog = useRef<HTMLDialogElement>(null)
  const status = useQuery({
    queryKey: ['music-analysis-status'],
    queryFn: musicAnalysis.status,
    refetchInterval: 5000,
    retry: false,
  })
  const activeId = status.data?.activeJob?.id
  const jobId = state.jobId ?? (activeId !== state.dismissedJobId ? activeId : undefined)
  useEffect(() => {
    if (!state.jobId && activeId && activeId !== state.dismissedJobId) state.setJob(activeId)
  }, [activeId, state])
  const jobQuery = useQuery({
    queryKey: ['music-analysis-job', jobId],
    enabled: !!jobId,
    queryFn: () => musicAnalysis.job(jobId!),
    retry: false,
    refetchInterval: (q) => (analysisRunning(q.state.data?.status) || !q.state.data ? 1200 : false),
  })
  const job = jobQuery.data
  const running = analysisRunning(
    job?.status ?? (activeId === jobId ? status.data?.activeJob?.status : undefined),
  )
  const [bpm, setBpm] = useState(true),
    [key, setKey] = useState(false)
  const [compare, setCompare] = useState(false)
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [summary, setSummary] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [applied, setApplied] = useState<
    Record<string, { message: string; bpm: boolean; key: boolean }>
  >({})
  const [page, setPage] = useState(0)
  const [requestVersion, setRequestVersion] = useState(state.requestVersion)
  if (requestVersion !== state.requestVersion) {
    setRequestVersion(state.requestVersion)
    if (state.preset === 'missing-bpm') {
      setBpm(true)
      setKey(false)
      setCompare(false)
    }
  }
  useEffect(() => {
    if (!state.open) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = dialog.current
    element?.showModal()
    return () => {
      element?.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [state.open])
  const draft = (row: AnalysisRow) => drafts[row.trackId] ?? analysisDraft(row)
  const change = (row: AnalysisRow, patch: Partial<Draft>) =>
    setDrafts((old) => ({
      ...old,
      [row.trackId]: { ...(old[row.trackId] ?? analysisDraft(row)), ...patch },
    }))
  const candidates = (job?.rows ?? []).filter(
    (r) =>
      r.status === 'review' &&
      ((draft(r).useBpm && !applied[r.trackId]?.bpm) ||
        (draft(r).useKey && !applied[r.trackId]?.key)),
  )
  const invalid = candidates.some(
    (r) =>
      draft(r).useBpm &&
      !applied[r.trackId]?.bpm &&
      (!draft(r).bpm.trim() ||
        !Number.isFinite(Number(draft(r).bpm)) ||
        Number(draft(r).bpm) < 30 ||
        Number(draft(r).bpm) > 400),
  )
  const start = async () => {
    setBusy(true)
    setError('')
    setSummary('')
    try {
      const next = await musicAnalysis.start(state.ids, bpm, key, compare)
      setDrafts({})
      setApplied({})
      setPage(0)
      state.setJob(next.id)
      qc.setQueryData(['music-analysis-job', next.id], next)
      await qc.invalidateQueries({ queryKey: ['music-analysis-status'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start analysis. Please retry.')
    } finally {
      setBusy(false)
    }
  }
  const cancel = async () => {
    if (!jobId) return
    setBusy(true)
    setError('')
    try {
      await musicAnalysis.cancel(jobId)
      await jobQuery.refetch()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel analysis. Please retry.')
    } finally {
      setBusy(false)
    }
  }
  const apply = async () => {
    if (!jobId) return
    setBusy(true)
    setError('')
    let count = 0
    let failed = 0
    try {
      for (const row of candidates) {
        const d = draft(row)
        try {
          const result = await musicAnalysis.apply(
            jobId,
            row.trackId,
            d.useBpm && !applied[row.trackId]?.bpm ? Number(d.bpm) : null,
            d.useKey && !applied[row.trackId]?.key ? row.result!.key : null,
          )
          if (result.bpmApplied || result.keyApplied) count++
          setApplied((old) => ({
            ...old,
            [row.trackId]: {
              message: result.message,
              bpm: old[row.trackId]?.bpm || d.useBpm,
              key: old[row.trackId]?.key || d.useKey,
            },
          }))
        } catch (e) {
          failed++
          setError(e instanceof Error ? e.message : 'Could not apply a suggestion. Please retry.')
        }
      }
      setSummary(
        `${count} ${count === 1 ? 'track' : 'tracks'} updated${failed ? ` · ${failed} failed; their suggestions remain selected for retry` : ''}. Existing values, audio and cues preserved.`,
      )
      // Refresh all consumers of BPM/key, including open preparation/recommendations/mix plans.
      await qc.invalidateQueries({
        predicate: (q) => !String(q.queryKey[0]).startsWith('music-analysis'),
      })
    } finally {
      setBusy(false)
    }
  }
  const finished = job?.rows.filter((r) => !['queued', 'running'].includes(r.status)).length ?? 0
  const hasErrors = status.error || jobQuery.error
  return (
    <>
      {!state.open && (jobId || (hasErrors && state.jobId)) && (
        <div className="music-analysis-indicator">
          <AudioLines size={16} aria-hidden="true" />
          <button onClick={() => state.show()}>
            {hasErrors
              ? 'Audio analysis: connection lost — open to retry'
              : running
                ? `Analysing audio · ${finished}/${job?.rows.length ?? 0}`
                : 'Audio analysis · review results'}
          </button>
          {!running && (
            <IconButton label="Dismiss analysis results" onClick={state.dismiss}>
              <X size={16} />
            </IconButton>
          )}
        </div>
      )}
      {state.open && (
        <dialog
          ref={dialog}
          aria-labelledby="music-analysis-heading"
          className="ui-dialog music-analysis-dialog"
          onCancel={(e) => {
            e.preventDefault()
            if (!busy) state.hide()
          }}
        >
          <header className="music-analysis-heading">
            <div>
              <p className="music-analysis-eyebrow">AUDIO ANALYSIS / EXPERIMENTAL</p>
              <h2 id="music-analysis-heading" className="ui-dialog-heading">
                Find the tempo. Find the key.
              </h2>
            </div>
            <IconButton label="Close audio analysis" disabled={busy} onClick={state.hide}>
              <X size={18} />
            </IconButton>
          </header>
          <p className="music-analysis-intro">
            Local suggestions, reviewed by you. Existing BPM and key values stay untouched—even
            those in file tags. No audio uploads or file changes.
          </p>
          <fieldset disabled={busy || running} className="music-analysis-options">
            <legend className="sr-only">What to analyse</legend>
            <label>
              <input type="checkbox" checked={bpm} onChange={(e) => setBpm(e.target.checked)} />{' '}
              Find BPM
            </label>
            <label>
              <input type="checkbox" checked={key} onChange={(e) => setKey(e.target.checked)} />{' '}
              Find key (Camelot · experimental)
            </label>
            <label className="music-analysis-compare">
              <input
                type="checkbox"
                checked={compare}
                onChange={(e) => setCompare(e.target.checked)}
              />{' '}
              Compare existing values too{' '}
              <span>For testing accuracy; still never overwrites them.</span>
            </label>
          </fieldset>
          <p className="music-analysis-help">
            Key finding is experimental. Pitch analysis and tuning correction compare tonal sections
            across the song; ambiguous keys still need your ears. Existing keys are preserved, and
            all key suggestions start unchecked.
          </p>
          {state.preset === 'missing-bpm' && (
            <p className="music-analysis-help">
              Missing BPMs in your filtered tracklist, across all pages. Review the results before
              applying; existing BPMs and keys are preserved.
            </p>
          )}
          <div className="music-analysis-actions">
            <Button
              variant="primary"
              disabled={
                busy ||
                running ||
                !state.ids.length ||
                (!bpm && !key) ||
                !status.data?.available ||
                !!hasErrors
              }
              onClick={() => void start()}
            >
              Analyse {state.ids.length.toLocaleString()}{' '}
              {state.ids.length === 1 ? 'track' : 'tracks'}
            </Button>
            {running && (
              <Button disabled={busy || job?.status === 'cancelling'} onClick={() => void cancel()}>
                {job?.status === 'cancelling' ? 'Cancelling…' : 'Cancel analysis'}
              </Button>
            )}
            {jobId && !running && (
              <Button
                disabled={busy}
                onClick={() => {
                  state.dismiss()
                  setDrafts({})
                  setApplied({})
                  setSummary('')
                  setError('')
                  setPage(0)
                  qc.removeQueries({ queryKey: ['music-analysis-job', jobId], exact: true })
                  void status.refetch()
                }}
              >
                Clear results
              </Button>
            )}
            {running && (
              <span role="status">
                {finished}/{job?.rows.length} ·{' '}
                {job?.rows.find((r) => r.status === 'running')?.title ?? 'Waiting…'}
              </span>
            )}
          </div>
          {running && (
            <progress
              aria-label="Audio analysis progress"
              max={job?.rows.length ?? 1}
              value={finished}
            />
          )}
          {status.data?.available === false && (
            <p role="alert">FFmpeg is unavailable. Check its path in Settings, then retry.</p>
          )}
          {(hasErrors || error) && (
            <p role="alert" className="music-analysis-error">
              {error || status.error?.message || jobQuery.error?.message}
              {hasErrors && (
                <button
                  onClick={() => {
                    void status.refetch()
                    void jobQuery.refetch()
                  }}
                >
                  Retry connection
                </button>
              )}
            </p>
          )}
          {job && (
            <>
              <div className="music-analysis-result-heading">
                <h3>Review suggestions</h3>
                <span>
                  {job.rows.filter((r) => r.status === 'skipped').length} skipped ·{' '}
                  {job.rows.filter((r) => r.status === 'failed').length} failed
                </span>
              </div>
              <p className="music-analysis-help">
                Half/double tempo readings can happen. Uncertain suggestions start unchecked.
                Strength is an algorithm score, not a percentage accuracy. No beatgrid or cue
                positions are changed.
              </p>
              {job.rows.some(
                (r) =>
                  r.status === 'review' &&
                  r.bpmRequested &&
                  r.result?.bpm &&
                  !(r.existingBpm && r.existingBpm > 0) &&
                  !applied[r.trackId]?.bpm,
              ) && (
                <Button
                  small
                  disabled={busy || running}
                  tooltip="Includes uncertain estimates. Check the values before applying them."
                  onClick={() => {
                    setDrafts((old) => {
                      const next = { ...old }
                      for (const row of job.rows)
                        if (
                          row.status === 'review' &&
                          row.bpmRequested &&
                          row.result?.bpm &&
                          !(row.existingBpm && row.existingBpm > 0) &&
                          !applied[row.trackId]?.bpm
                        )
                          next[row.trackId] = {
                            ...(old[row.trackId] ?? analysisDraft(row)),
                            useBpm: true,
                          }
                      return next
                    })
                  }}
                >
                  Select all missing BPM suggestions
                </Button>
              )}
              <ul className="music-analysis-results" aria-label="Audio analysis results">
                {job.rows.slice(page * 50, (page + 1) * 50).map((row) => {
                  const d = draft(row),
                    result = row.result
                  const bpmLocked =
                    !row.bpmRequested || !result?.bpm || !!(row.existingBpm && row.existingBpm > 0)
                  const keyLocked = !row.keyRequested || !result?.key || !!row.existingKey?.trim()
                  return (
                    <li key={row.trackId}>
                      <div className="music-analysis-track">
                        <strong>{row.title}</strong>
                        <span>
                          {applied[row.trackId]?.message ??
                            (row.status === 'review'
                              ? row.cached
                                ? 'Cached suggestion'
                                : 'Ready for review'
                              : (row.message ?? row.status))}
                        </span>
                        {result?.decodeWarning && (
                          <p className="music-analysis-help">{result.decodeWarning}</p>
                        )}
                      </div>
                      {result && (
                        <div className="music-analysis-fields">
                          {row.bpmRequested && (
                            <div>
                              <label>
                                <input
                                  type="checkbox"
                                  aria-label={`Apply BPM for ${row.title}`}
                                  checked={d.useBpm && !applied[row.trackId]?.bpm}
                                  disabled={
                                    busy || running || bpmLocked || !!applied[row.trackId]?.bpm
                                  }
                                  onChange={(e) => change(row, { useBpm: e.target.checked })}
                                />
                                BPM
                              </label>
                              <div className="music-analysis-tempo">
                                <input
                                  type="number"
                                  min={30}
                                  max={400}
                                  step="0.01"
                                  aria-label={`Reviewed BPM for ${row.title}`}
                                  value={d.bpm}
                                  disabled={busy || bpmLocked || !!applied[row.trackId]?.bpm}
                                  onChange={(e) => change(row, { bpm: e.target.value })}
                                />
                                <button
                                  aria-label={`Halve BPM for ${row.title}`}
                                  disabled={busy || bpmLocked || !!applied[row.trackId]?.bpm}
                                  onClick={() =>
                                    change(row, {
                                      bpm: String(Math.round((Number(d.bpm) / 2) * 100) / 100),
                                    })
                                  }
                                >
                                  ½
                                </button>
                                <button
                                  aria-label={`Double BPM for ${row.title}`}
                                  disabled={busy || bpmLocked || !!applied[row.trackId]?.bpm}
                                  onClick={() =>
                                    change(row, {
                                      bpm: String(Math.round(Number(d.bpm) * 2 * 100) / 100),
                                    })
                                  }
                                >
                                  ×2
                                </button>
                              </div>
                              <small>
                                {row.existingBpm && row.existingBpm > 0
                                  ? `Existing: ${row.existingBpm} · preserved`
                                  : result.bpm === null
                                    ? 'No reliable tempo found'
                                    : result.tempoUncertain
                                      ? 'Uncertain — check by ear'
                                      : 'Review the beat'}
                              </small>
                            </div>
                          )}
                          {row.keyRequested && (
                            <div>
                              <label>
                                <input
                                  type="checkbox"
                                  aria-label={`Apply key for ${row.title}`}
                                  checked={d.useKey && !applied[row.trackId]?.key}
                                  disabled={
                                    busy || running || keyLocked || !!applied[row.trackId]?.key
                                  }
                                  onChange={(e) => change(row, { useKey: e.target.checked })}
                                />
                                Key
                              </label>
                              <strong className="music-analysis-key">{result.key ?? '—'}</strong>
                              {result.keyWarning && <small>{result.keyWarning}</small>}
                              <small>
                                {row.existingKey
                                  ? `Existing: ${row.existingKey} · preserved`
                                  : !result.key
                                    ? 'No reliable key found'
                                    : result.keyUncertain
                                      ? 'Uncertain — audition first'
                                      : 'Review the harmony'}
                              </small>
                            </div>
                          )}
                          <details>
                            <summary>Analysis details</summary>
                            <p>
                              Tempo strength {result.tempoStrength.toFixed(2)} · key strength{' '}
                              {result.keyStrength.toFixed(2)}. {result.engine}. 90–180 BPM
                              dance-music range. Octave-adjusted tempos and all key suggestions
                              require explicit review. Drifting tempo and ambiguous harmony may not
                              have a single answer.
                            </p>
                            {row.keyRequested && result.keyAgreement != null && (
                              <p>
                                Tonal section agreement: {Math.round(result.keyAgreement * 100)}%
                                (not probability of correctness).
                                {result.alternativeKey
                                  ? ` Alternative interpretation: ${result.alternativeKey}.`
                                  : ''}
                                {result.tuningCents != null
                                  ? ` Tuning offset: ${result.tuningCents.toFixed(1)} cents from A=440 Hz.`
                                  : ''}
                              </p>
                            )}
                          </details>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
              {job.rows.length > 50 && (
                <div className="music-analysis-actions">
                  <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <span>
                    Page {page + 1} of {Math.ceil(job.rows.length / 50)}
                  </span>
                  <Button
                    disabled={(page + 1) * 50 >= job.rows.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
              {invalid && (
                <p role="alert">
                  Enter a reviewed BPM between 30 and 400, or uncheck that suggestion.
                </p>
              )}
              <footer className="music-analysis-actions">
                <Button
                  variant="primary"
                  disabled={busy || running || !candidates.length || invalid || !!hasErrors}
                  onClick={() => void apply()}
                >
                  Apply selected missing values ({candidates.length})
                </Button>
                <span>Across all result pages · saved to WISP only</span>
              </footer>
            </>
          )}
          {summary && <p role="status">{summary}</p>}
          <p className="music-analysis-help">
            You can close this window and keep browsing while analysis runs. Closing WISP stops the
            job; saved suggestions are reused when you analyse again.
          </p>
        </dialog>
      )}
    </>
  )
}
