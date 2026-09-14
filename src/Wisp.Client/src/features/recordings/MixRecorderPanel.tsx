import { useEffect, useRef, useState } from 'react'
import { CircleDot, FolderOpen, Square } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../../api/client'
import { mixPlans } from '../../api/mixPlans'
import { useRecordingNavigation } from './useRecordingTracklist'
import { bridge, bridgeAvailable, invoke } from '../../bridge'
import { alertDialog, confirmDialog } from '../../components/dialog'
import { usePlayer } from '../../state/player'
import { useCurrentPage } from '../../state/currentPage'

import { useRecorderStatus, statusKey, type Status } from './useRecorderStatus'
const duration = (seconds: number) =>
  `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`

export function MixRecordingIndicator() {
  const status = useRecorderStatus()
  const handlingClose = useRef(false)
  const setPage = useCurrentPage((s) => s.setPage)
  useEffect(() => {
    if (!status.data?.busy) return
    const pause = () => {
      document.querySelectorAll('audio').forEach((a) => a.pause())
      usePlayer.getState()._commands?.pause()
    }
    pause()
    document.addEventListener('play', pause, true)
    const unsubscribe = usePlayer.subscribe((state) => {
      if (state.isPlaying || state.pendingPlay) pause()
    })
    return () => {
      document.removeEventListener('play', pause, true)
      unsubscribe()
    }
  }, [status.data?.busy])
  useEffect(() => {
    if (!status.data?.closeRequested || handlingClose.current) return
    handlingClose.current = true
    void (async () => {
      try {
        const confirmed = await confirmDialog({
          title: 'Recording is still active',
          message: 'Keep WISP open to continue, or stop and finish saving before closing.',
          confirmLabel: 'Stop and save',
          cancelLabel: 'Keep recording',
        })
        if (!confirmed) {
          await apiPost('/api/recordings/keep-recording')
          return
        }
        const current = await apiGet<Status>('/api/recordings/status')
        if (current.busy && current.session)
          await apiPost(`/api/recordings/${current.session.id}/stop`)
        setPage('recordings')
        // Large-file hashing can take time. Keep the window open throughout.
        let state = await apiGet<Status>('/api/recordings/status')
        while (state.busy) {
          await new Promise((resolve) => setTimeout(resolve, 500))
          state = await apiGet<Status>('/api/recordings/status')
        }
        if (state.session?.state !== 'Ready')
          throw new Error(
            'The recording needs recovery. WISP has stayed open; check the recovery controls.',
          )
        await invoke('closeAfterRecording')
      } catch (e) {
        await apiPost('/api/recordings/keep-recording').catch(() => {})
        await alertDialog({
          title: 'WISP stayed open',
          message: e instanceof Error ? e.message : 'Check the recording before closing.',
          tone: 'error',
        })
      } finally {
        handlingClose.current = false
      }
    })()
    // A second native close can arrive between polls, leaving the boolean true
    // in both snapshots. Recheck every successful poll, not only boolean edges.
  }, [status.data?.closeRequested, status.dataUpdatedAt, setPage])
  if (!status.data?.busy) return null
  return (
    <button
      className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-left text-sm text-red-400"
      onClick={() => {
        useRecordingNavigation.getState().record()
        setPage('recordings')
      }}
    >
      ● Mix recording · {duration(status.data.seconds)} · {status.data.session?.state} · View / stop
    </button>
  )
}

export function MixRecorderPanel({
  endpointId,
  inputTestBusy,
}: {
  endpointId: string
  inputTestBusy: boolean
}) {
  const qc = useQueryClient()
  const status = useRecorderStatus()
  const plans = useQuery({ queryKey: ['mixPlans'], queryFn: mixPlans.list })
  const planId = useRecordingNavigation((s) => s.blueprintPlanId)
  const previous = useRecordingNavigation((s) => s.previousTake)
  const settings = useQuery({
    queryKey: ['recording-settings'],
    queryFn: () => apiGet<{ folder: string | null }>('/api/recordings/settings'),
  })
  const [title, setTitle] = useState(() =>
    previous ? `${previous.title.slice(0, 180)} — next take` : 'Practice mix',
  )
  const [folder, setFolder] = useState<string | null>(null)
  const request = useRef<string | null>(null)
  const stopping = useRef(false)
  useEffect(() => {
    request.current = null
  }, [planId])
  const destination = folder ?? settings.data?.folder ?? ''
  const busy = status.data?.busy ?? false
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: statusKey })
    void qc.invalidateQueries({ queryKey: ['recording-workspace-mixes'] })
  }
  const start = useMutation({
    mutationFn: async () => {
      usePlayer.getState()._commands?.pause()
      document.querySelectorAll('audio').forEach((a) => a.pause())
      request.current ??= crypto.randomUUID()
      const id = request.current
      await apiPost('/api/recordings/start', {
        requestId: id,
        title,
        folder: destination,
        endpointId,
        previousTakeId: previous?.id ?? null,
        planId,
      })
      useRecordingNavigation.setState({ selected: id })
    },
    onSuccess: () => {
      request.current = null
      refresh()
      void qc.invalidateQueries({ queryKey: ['plan-recordings'] })
    },
  })
  const stop = useMutation({
    mutationFn: () => apiPost(`/api/recordings/${status.data!.session!.id}/stop`),
    onSuccess: () => {
      stopping.current = true
      refresh()
    },
  })
  useEffect(() => {
    if (stopping.current && status.data?.session && !status.data.busy) {
      stopping.current = false
      useRecordingNavigation.getState().select(status.data.session.id)
    }
  }, [status.data])
  const pick = async () => {
    try {
      const result = await bridge.pickFolder(destination)
      if (result.path) {
        setFolder(result.path)
        request.current = null
      }
    } catch (e) {
      await alertDialog({ title: 'Folder selection failed', message: String(e), tone: 'error' })
    }
  }
  const error = start.error ?? stop.error ?? status.error ?? settings.error
  return (
    <section aria-label="Full-length mix recording" className="wm-recorder">
      {!busy ? (
        <>
          <div className="wm-record-fields">
            <label>
              Mix title
              <input
                className="wm-field"
                value={title}
                maxLength={200}
                disabled={start.isPending}
                onChange={(e) => {
                  setTitle(e.target.value)
                  request.current = null
                }}
              />
            </label>
            <label>
              Recordings folder
              <input
                className="wm-field"
                value={destination}
                disabled={start.isPending}
                onChange={(e) => {
                  setFolder(e.target.value)
                  request.current = null
                }}
              />
            </label>
            <label>
              Planned set (optional)
              <select
                className="wm-field"
                value={planId ?? ''}
                disabled={start.isPending}
                onChange={(e) =>
                  useRecordingNavigation.getState().chooseBlueprint(e.target.value || null)
                }
              >
                <option value="">No Mix Plan</option>
                {planId && !plans.data?.some((p) => p.id === planId) && (
                  <option value={planId}>Selected plan unavailable</option>
                )}
                {plans.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="wm-button"
              disabled={start.isPending || !bridgeAvailable()}
              onClick={() => void pick()}
            >
              <FolderOpen /> Choose recordings folder
            </button>
          </div>
          {previous && (
            <p className="wm-subtitle">
              New take linked to {previous.title}.{' '}
              <button
                className="underline"
                onClick={() => useRecordingNavigation.setState({ previousTake: null })}
              >
                Clear link
              </button>
            </p>
          )}
          <p className="wm-subtitle">
            Your planned set is saved as a blueprint when recording starts. Confirm what you
            actually played afterwards.
          </p>
          <div className="wm-record-start">
            <button
              className="wm-button wm-primary"
              disabled={
                inputTestBusy ||
                start.isPending ||
                !endpointId ||
                !title.trim() ||
                !destination ||
                !status.data ||
                status.isError
              }
              onClick={() => start.mutate()}
            >
              <CircleDot /> {start.isPending ? 'Starting…' : 'Start mix recording'}
            </button>
            <p className="wm-subtitle">
              Lossless stereo master. No live monitoring or automatic gain changes.
            </p>
          </div>
        </>
      ) : (
        <div aria-label="Mix recording status" className="wm-active-capture">
          <div className="wm-heading">
            <div>
              <p className="wm-eyebrow">Recording desk</p>
              <h1>{status.data?.session?.title}</h1>
            </div>
            <span role="status" className="wm-capture-state">
              <CircleDot /> {status.data?.session?.state}
            </span>
          </div>
          <p className="wm-record-clock">{duration(status.data?.seconds ?? 0)}</p>
          <p className="wm-record-caption">
            Stereo master · {status.data?.session?.sampleRate.toLocaleString()} Hz
          </p>
          <div className="wm-meters">
            <CaptureMeter label="Left" peak={status.data?.leftPeak ?? 0} />
            <CaptureMeter label="Right" peak={status.data?.rightPeak ?? 0} />
          </div>
          {status.data?.clipped ? (
            <p className="wm-warning" role="status">
              Clipping detected. Lower the input level; recorded clipping cannot be repaired here.
            </p>
          ) : (
            <p className="wm-record-caption">
              No clipping reported · check that both channels are receiving audio
            </p>
          )}
          <div className="wm-record-start">
            <button
              className="wm-button wm-danger"
              disabled={stop.isPending || status.data?.session?.state === 'Finalising'}
              onClick={() => stop.mutate()}
            >
              <Square />{' '}
              {stop.isPending || status.data?.session?.state === 'Finalising'
                ? 'Saving mix…'
                : 'Stop and save mix'}
            </button>
          </div>
          <div className="wm-record-routing">
            <div>
              <span className="wm-eyebrow">Input</span>
              <p>{status.data?.session?.deviceName}</p>
            </div>
            <div>
              <span className="wm-eyebrow">Recording to</span>
              <p className="break-all">{status.data?.session?.directoryPath}</p>
            </div>
          </div>
          <p className="wm-subtitle">
            Checkpointed: {duration(status.data?.savedSeconds ?? 0)}
            {status.data?.remainingSeconds != null
              ? ` · Estimated space remaining: ${duration(status.data.remainingSeconds)}`
              : ''}
            . Keep WISP open and the computer awake.
          </p>
        </div>
      )}
      {plans.error && <p role="alert">Mix Plans could not load. You can record without a plan.</p>}
      {status.data?.session?.issue && <p role="alert">{status.data.session.issue}</p>}
      {error && <p role="alert">{error.message}</p>}
      <p className="wm-subtitle">
        Masters stay under WISP Recordings, outside the track library. After saving, export a
        separate 320 kbps MP3 from the mix’s Exports tab. Large masters use RF64.
      </p>
    </section>
  )
}

function CaptureMeter({ label, peak }: { label: string; peak: number }) {
  const db = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60
  return (
    <div className="wm-meter-row">
      <span>{label === 'Left' ? 'L' : 'R'}</span>
      <div
        className="wm-meter-track"
        role="meter"
        aria-label={`Mix ${label.toLowerCase()} input`}
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={Math.min(0, db)}
        aria-valuetext={peak > 0 ? `${db.toFixed(1)} dBFS` : 'Silence'}
      >
        {Array.from({ length: 40 }, (_, i) => (
          <span
            key={i}
            className={
              i / 40 <= (db + 60) / 60 && peak > 0 ? (i > 35 ? 'wm-meter-hot' : 'wm-meter-lit') : ''
            }
          />
        ))}
      </div>
      <span className="wm-time">{peak > 0 ? `${db.toFixed(1)} dBFS` : '−∞ dBFS'}</span>
    </div>
  )
}
