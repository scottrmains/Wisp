import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  MessageSquare,
  ListMusic,
  Download,
  Info,
  BookmarkPlus,
} from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../../api/client'
import { bridge, bridgeAvailable } from '../../bridge'
import { usePlayer } from '../../state/player'
import { RecordingInputPage } from './RecordingInputPage'
import { RecordingWaveform, type Peaks } from './RecordingWaveform'
import { useRecorderStatus } from './useRecorderStatus'
import { RecordingTracklistPanel } from './RecordingTracklistPanel'
import { useRecordingNavigation, useRecordingTracklist } from './useRecordingTracklist'
import { RecordingFeedbackPanel } from './RecordingFeedbackPanel'
import {
  useDraftStorageWarning,
  useFeedbackDrafts,
  useRecordingFeedback,
} from './useRecordingFeedback'
import { ExportActivity, RecordingExportPanel } from './RecordingExportPanel'
import { useMixExports, exportName } from './useMixExports'
import { MixesLibrary, type Mix } from './MixesLibrary'
import { RecordingFileActions } from './RecordingFileActions'
import { ReviseRecordingPlan } from './ReviseRecordingPlan'
import './mixes.css'

interface Job {
  id: string
  recordingId: string
  kind: string
  state: string
  progress: number
  error: string | null
}
interface Marker {
  id: string
  seconds: number
  label: string
}
interface Review {
  revision: number
  rating: number | null
  markers: Marker[]
}
const button = 'wm-button'
const field = 'wm-field'
const clock = (n: number) =>
  `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(Math.floor(n % 60)).padStart(2, '0')}`
const mixesKey = ['recording-workspace-mixes']

export function RecordingsWorkspace() {
  const qc = useQueryClient()
  const recorder = useRecorderStatus()
  const mixes = useQuery({
    queryKey: mixesKey,
    queryFn: () => apiGet<Mix[]>('/api/recording-workspace/mixes'),
    refetchInterval: 2000,
  })
  const job = useQuery({
    queryKey: ['recording-workspace-job'],
    queryFn: async () => (await apiGet<Job | null>('/api/recording-workspace/job')) ?? null,
    refetchInterval: 1000,
  })
  const nav = useRecordingNavigation()
  const scroller = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    scroller.current?.scrollTo(0, 0)
  }, [nav.view, nav.selected])
  const feedbackDrafts = useFeedbackDrafts((s) => s.drafts)
  const draftStorageWarning = useDraftStorageWarning((s) => s.warning)
  const [error, setError] = useState<string | null>(null)
  const busy = job.data?.state === 'Running'
  const active = mixes.data?.find((m) => m.session.id === nav.selected)
  const importMix = async () => {
    setError(null)
    try {
      const source = await bridge.pickAudioFile()
      if (!source.path) return
      const destination = await bridge.pickFolder()
      if (!destination.path) return
      const next = await apiPost<Job>('/api/recording-workspace/import', {
        requestId: crypto.randomUUID(),
        path: source.path,
        folder: destination.path,
      })
      nav.select(next.recordingId)
      await qc.invalidateQueries({ queryKey: ['recording-workspace-job'] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import could not start.')
    }
  }
  return (
    <div className="wm-workspace" ref={scroller}>
      <div className="wm-page">
        <ExportActivity />
        {draftStorageWarning && (
          <p role="alert" className="wm-warning">
            {draftStorageWarning}
          </p>
        )}
        {Object.keys(feedbackDrafts).length > 0 && (
          <div className="wm-draft-banner" role="status">
            Local feedback drafts:{' '}
            {Object.keys(feedbackDrafts).map((id) => (
              <button className="wm-button wm-quiet" key={id} onClick={() => nav.select(id)}>
                {mixes.data?.find((m) => m.session.id === id)?.session.title ?? 'Unavailable mix'}
                {feedbackDrafts[id].error
                  ? ' · Save failed'
                  : feedbackDrafts[id].saving
                    ? ' · Saving'
                    : ' · Unsaved'}
              </button>
            ))}
          </div>
        )}
        {(error || mixes.error || job.error) && (
          <p role="alert">{error ?? mixes.error?.message ?? job.error?.message}</p>
        )}
        {job.data?.id && (
          <div className="wm-processing" role="status">
            <span>
              {job.data.kind === 'import' ? 'Mix import' : 'Waveform'} · {job.data.state}
            </span>
            {busy && (
              <>
                <progress
                  aria-label="Recording processing progress"
                  value={job.data.progress}
                  max={1}
                />
                <button
                  className="wm-button"
                  onClick={() => {
                    void apiPost(`/api/recording-workspace/job/${job.data!.id}/cancel`).catch((e) =>
                      setError(String(e)),
                    )
                  }}
                >
                  Cancel processing
                </button>
              </>
            )}
            {job.data.error && <span role="alert">{job.data.error}</span>}
          </div>
        )}
        {nav.view === 'library' ? (
          <MixesLibrary
            mixes={mixes.data ?? []}
            loading={mixes.isPending}
            importMix={() => void importMix()}
            importDisabled={!!recorder.data?.busy || !!busy || !bridgeAvailable()}
          />
        ) : nav.view === 'record' ? (
          <>
            <button className="wm-button wm-quiet wm-back" onClick={nav.home}>
              <ArrowLeft /> All mixes
            </button>
            <RecordingInputPage />
          </>
        ) : (
          <>
            <button className="wm-button wm-quiet wm-back" onClick={nav.home}>
              <ArrowLeft /> All mixes
            </button>
            {active ? (
              <MixPlayback
                key={active.session.id}
                mix={active}
                processing={!!busy}
                job={job.data ?? null}
              />
            ) : (
              <div className="wm-empty" role="status">
                {mixes.isPending || busy
                  ? 'Preparing your mix…'
                  : 'This mix is unavailable. Return to All mixes to choose another.'}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MixPlayback({ mix, processing, job }: { mix: Mix; processing: boolean; job: Job | null }) {
  const [section, setSection] = useState<'review' | 'tracklist' | 'exports'>('review')
  const [details, setDetails] = useState(false)
  const [waveHeight, setWaveHeight] = useState(146)
  const id = mix.session.id
  const audio = useRef<HTMLAudioElement>(null)
  const qc = useQueryClient()
  const recorder = useRecorderStatus()
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.8)
  const [zoom, setZoom] = useState(1)
  const [start, setStart] = useState(0)
  const [preRoll, setPreRoll] = useState(3)
  const [loopStart, setLoopStart] = useState(0)
  const [loopEnd, setLoopEnd] = useState(mix.duration)
  const [loop, setLoop] = useState(false)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const review = useQuery({
    queryKey: ['recording-review', id],
    queryFn: () => apiGet<Review>(`/api/recording-workspace/${id}/review`),
  })
  const tracklist = useRecordingTracklist(id)
  const feedback = useRecordingFeedback(id)
  const exports = useMixExports(id)
  const [playbackExport, setPlaybackExport] = useState('auto')
  const largeMaster = mix.session.audioBytes >= 4294967200
  const playableExports = (exports.data ?? []).filter(
    (e) =>
      e.available && (e.format === 'mp3' || (e.format === 'wav' && e.outputBytes < 4294967200)),
  )
  const derived =
    playbackExport === 'auto'
      ? largeMaster
        ? playableExports.find((e) => e.format === 'mp3')
        : undefined
      : playableExports.find((e) => e.id === playbackExport)
  const peaks = useQuery({
    queryKey: ['recording-peaks', id],
    queryFn: async () =>
      (await apiGet<Peaks | null>(`/api/recording-workspace/${id}/peaks`)) ?? null,
    enabled: mix.session.state === 'Ready' && !mix.missing,
    refetchInterval: processing ? 1000 : false,
  })
  useEffect(() => {
    if (job?.recordingId === id && job.state === 'Ready') {
      void qc.invalidateQueries({ queryKey: ['recording-peaks', id] })
      void qc.invalidateQueries({ queryKey: ['recording-thumbnail', id] })
    }
  }, [job?.recordingId, job?.state, id, qc])
  const save = useMutation({
    mutationFn: (next: Review) => apiPost(`/api/recording-workspace/${id}/review`, next),
    onSuccess: () => {
      setLabel('')
      void qc.invalidateQueries({ queryKey: ['recording-review', id] })
      void qc.invalidateQueries({ queryKey: ['recording-feedback', id] })
      void qc.invalidateQueries({ queryKey: mixesKey })
    },
  })
  const live = recorder.data?.busy && recorder.data.session?.id === id
  const disabled =
    !!recorder.data?.busy ||
    mix.session.state !== 'Ready' ||
    (!derived && (mix.missing || largeMaster || playbackExport !== 'auto'))
  const span = Math.max(0.01, mix.duration / zoom)
  const seek = (time: number) => {
    const value = Math.min(mix.duration, Math.max(0, time))
    if (audio.current) audio.current.currentTime = value
    setPosition(value)
  }
  const toggle = async () => {
    if (!audio.current || disabled) return
    setError(null)
    if (audio.current.paused) {
      try {
        await audio.current.play()
      } catch {
        setError(
          'Playback failed. Reconnect the recording drive or relink its master under file management.',
        )
      }
    } else audio.current.pause()
  }
  useEffect(() => {
    if (recorder.data?.busy) audio.current?.pause()
  }, [recorder.data?.busy])
  useEffect(() => {
    const element = audio.current!
    const otherPlay = (event: Event) => {
      if (event.target !== element) element.pause()
    }
    document.addEventListener('play', otherPlay, true)
    const unsubscribe = usePlayer.subscribe((state) => {
      if (state.isPlaying || state.pendingPlay) element.pause()
    })
    return () => {
      document.removeEventListener('play', otherPlay, true)
      unsubscribe()
      element.pause()
    }
  }, [])
  const mark = () => {
    if (!review.data) return
    save.mutate({
      ...review.data,
      markers: [
        ...review.data.markers,
        {
          id: crypto.randomUUID(),
          seconds: live ? recorder.data!.seconds : position,
          label: label.trim() || 'Review this moment',
        },
      ],
    })
  }
  return (
    <section aria-label="Mix playback" className="wm-mix-detail">
      <header className="wm-heading">
        <div>
          <h1>{mix.session.title}</h1>
          <p className="wm-subtitle">
            {new Date(mix.session.startedAt).toLocaleDateString()} · {clock(mix.duration)} · Stereo
            master
          </p>
        </div>
        <button
          className="wm-button wm-quiet"
          aria-expanded={details}
          onClick={() => setDetails(!details)}
        >
          <Info /> Details & files
        </button>
      </header>
      {(details || mix.missing || mix.session.state === 'Recoverable') && (
        <RecordingFileActions session={mix.session} />
      )}
      <div className="wm-sticky-player">
        {playableExports.length > 0 && (
          <label className="flex flex-wrap items-center gap-2 text-sm">
            Playback source
            <select
              className={field}
              value={playbackExport}
              onChange={(e) => {
                audio.current?.pause()
                setPlaying(false)
                setPosition(0)
                setPlaybackExport(e.target.value)
              }}
            >
              <option value="auto">
                {largeMaster ? 'Automatic · verified MP3 export' : 'Original master'}
              </option>
              {playableExports.map((e) => (
                <option key={e.id} value={e.id}>
                  {exportName(e.format)} · {new Date(e.createdAt).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
        )}
        <audio
          ref={audio}
          preload="none"
          src={
            disabled
              ? undefined
              : derived
                ? `/api/recording-exports/audio/${derived.id}`
                : `/api/recordings/${id}/audio`
          }
          onLoadedMetadata={() => {
            if (audio.current) audio.current.volume = volume
          }}
          onTimeUpdate={() => {
            const time = audio.current?.currentTime ?? 0
            if (loop && loopEnd > loopStart && time >= loopEnd) seek(loopStart)
            else setPosition(time)
          }}
          onPlay={() => {
            usePlayer.getState()._commands?.pause()
            document.querySelectorAll('audio').forEach((a) => {
              if (a !== audio.current) a.pause()
            })
            setPlaying(true)
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            if (loop && !disabled) {
              seek(loopStart)
              void audio.current?.play().catch(() => setError('Could not restart the loop.'))
            } else setPlaying(false)
          }}
          onError={() =>
            setError(
              derived
                ? 'Export audio unavailable. Reconnect its drive or create a new export. Your original master is unchanged.'
                : 'Audio unavailable. Reconnect its drive or relink the original master under file management.',
            )
          }
        />
        {peaks.data ? (
          <>
            <RecordingWaveform
              height={waveHeight}
              disabled={disabled}
              peaks={peaks.data}
              position={position}
              start={start}
              span={span}
              seek={seek}
              markers={[
                ...(review.data?.markers ?? []).map((m) => ({ ...m, kind: 'bookmark' as const })),
                ...(feedback.data?.annotations ?? []).map((a) => ({
                  seconds: a.seconds,
                  endSeconds: a.endSeconds,
                  label: a.text,
                  resolved: a.resolved,
                  kind: 'comment' as const,
                })),
                ...(tracklist.data?.entries ?? [])
                  .filter((e) => e.played && e.startSeconds != null)
                  .map((e) => ({
                    seconds: e.startSeconds!,
                    label: e.title,
                    kind: 'track' as const,
                  })),
              ]}
            />
            <div className="flex justify-between text-xs tabular-nums text-[var(--color-muted)]">
              <span>{clock(start)}</span>
              <span>{clock(Math.min(mix.duration, start + span))}</span>
            </div>
          </>
        ) : (
          <div className="flex min-h-40 items-center justify-center border-y border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
            {mix.missing
              ? 'Master file is missing. Reconnect its drive or use Relink missing master in Details & files.'
              : mix.session.state !== 'Ready'
                ? `Recording is ${mix.session.state.toLowerCase()}. Playback becomes available after saving.`
                : 'Open Waveform & loop controls to prepare the waveform. Playback works while analysis is pending.'}
          </div>
        )}
        {(error || save.error || peaks.error || review.error) && (
          <p role="alert" className="text-sm text-red-400">
            {error ?? save.error?.message ?? peaks.error?.message ?? review.error?.message}{' '}
            {save.isError && (
              <button className="underline" onClick={() => void review.refetch()}>
                Refresh review
              </button>
            )}
          </p>
        )}
        <div className="wm-transport">
          <button
            className={`${button} wm-primary`}
            disabled={disabled}
            onClick={() => void toggle()}
          >
            {playing ? <Pause /> : <Play />}
            {playing ? 'Pause mix' : 'Play mix'}
          </button>
          <button
            className={`${button} wm-quiet`}
            disabled={disabled}
            onClick={() => seek(position - 10)}
            aria-label="Back 10s"
          >
            <RotateCcw /> 10
          </button>
          <button
            className={`${button} wm-quiet`}
            disabled={disabled}
            onClick={() => seek(position + 10)}
            aria-label="Forward 10s"
          >
            <RotateCw /> 10
          </button>
          <span className="wm-time">
            {clock(position)} <span className="wm-muted">/ {clock(mix.duration)}</span>
          </span>
          <label className="flex items-center gap-2 text-sm">
            Volume
            <input
              aria-label="Mix volume"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => {
                setVolume(+e.target.value)
                if (audio.current) audio.current.volume = +e.target.value
              }}
            />
          </label>
        </div>
        <label className="wm-seek">
          Position
          <input
            aria-label="Mix position"
            type="range"
            min={0}
            max={mix.duration || 1}
            step={0.1}
            value={position}
            disabled={disabled}
            onChange={(e) => seek(+e.target.value)}
          />
        </label>
      </div>
      {largeMaster && (
        <p className="text-sm text-amber-300">
          {derived
            ? 'Playing a verified export; the RF64 master is unchanged. Review times still refer to the original recording.'
            : 'This RF64 master is too large for the browser player. Create a 320 kbps MP3 in Exports to enable in-app playback, or use an RF64-capable external player.'}
        </p>
      )}
      {recorder.data?.busy && (
        <p className="wm-warning">
          Playback is disabled during capture to avoid feeding audio back into the recording.
        </p>
      )}
      <details className="wm-player-tools">
        <summary>Waveform & loop controls</summary>
        <button
          className={button}
          disabled={processing || mix.missing || mix.session.state !== 'Ready'}
          onClick={() => {
            void apiPost(`/api/recording-workspace/${id}/peaks`)
              .then(() => qc.invalidateQueries({ queryKey: ['recording-workspace-job'] }))
              .catch((e) => setError(String(e)))
          }}
        >
          {peaks.data ? 'Rebuild waveform' : 'Prepare waveform'}
        </button>
        <label className="wm-seek">
          Waveform height
          <input
            type="range"
            min={80}
            max={220}
            step={10}
            value={waveHeight}
            onChange={(e) => setWaveHeight(+e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label>
            Zoom{' '}
            <select
              className={field}
              value={zoom}
              onChange={(e) => {
                const value = +e.target.value
                setZoom(value)
                setStart(Math.max(0, Math.min(position, mix.duration - mix.duration / value)))
              }}
            >
              {[1, 2, 4, 8, 16, 32].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 items-center gap-2">
            Visible window
            <input
              aria-label="Waveform window"
              className="min-w-0 flex-1"
              type="range"
              min={0}
              max={Math.max(0, mix.duration - span)}
              step={0.1}
              value={start}
              onChange={(e) => setStart(+e.target.value)}
            />
          </label>
        </div>
        <details>
          <summary className="cursor-pointer py-2 text-sm font-medium">Section loop</summary>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <button
              className={button}
              onClick={() => {
                setLoopStart(position)
                if (position >= loopEnd) setLoop(false)
              }}
            >
              Set loop start · {clock(loopStart)}
            </button>
            <button
              className={button}
              onClick={() => {
                setLoopEnd(position)
                if (position <= loopStart) setLoop(false)
              }}
            >
              Set loop end · {clock(loopEnd)}
            </button>
            <label>
              <input
                type="checkbox"
                checked={loop}
                disabled={disabled || loopEnd <= loopStart}
                onChange={(e) => setLoop(e.target.checked)}
              />{' '}
              Loop section
            </label>
          </div>
        </details>
      </details>
      <nav className="wm-section-nav" aria-label="Mix workspace sections">
        {(
          [
            { key: 'review', label: 'Review', Icon: MessageSquare },
            { key: 'tracklist', label: 'Tracklist', Icon: ListMusic },
            { key: 'exports', label: 'Exports', Icon: Download },
          ] as const
        ).map(({ key, label, Icon }) => (
          <button
            key={key}
            className="wm-section-button"
            aria-pressed={section === key}
            onClick={() => setSection(key)}
          >
            <Icon /> {label}
          </button>
        ))}
      </nav>
      <div hidden={section !== 'review'}>
        <RecordingFeedbackPanel
          id={id}
          title={mix.session.title}
          position={position}
          duration={mix.duration}
          live={!!live && recorder.data?.session?.state === 'Recording'}
          canPlay={!disabled}
          seek={seek}
          loop={(from, to) => {
            const end = Math.min(mix.duration, to)
            const begin = Math.max(0, from)
            if (end > begin) {
              setLoopStart(begin)
              setLoopEnd(end)
              setLoop(true)
              seek(begin)
            }
          }}
        />
        <details className="wm-bookmarks">
          <summary className="cursor-pointer py-2 text-sm font-medium">
            <BookmarkPlus className="inline" /> Quick bookmarks · {review.data?.markers.length ?? 0}
          </summary>
          <div className="space-y-3 pt-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label>
                Marker pre-roll{' '}
                <select
                  className={field}
                  value={preRoll}
                  onChange={(e) => setPreRoll(+e.target.value)}
                >
                  {[0, 3, 5, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}s
                    </option>
                  ))}
                </select>
              </label>
              {save.isPending && <span role="status">Saving review…</span>}
              {save.isSuccess && <span role="status">Review saved</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                Marker label
                <input
                  className={`${field} w-full`}
                  maxLength={200}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <button
                className={button}
                disabled={
                  !review.data || save.isPending || (mix.session.state !== 'Ready' && !live)
                }
                onClick={mark}
              >
                Mark this moment{live ? ' (live)' : ''}
              </button>
            </div>
            {review.data?.markers.length === 0 && (
              <p className="text-xs text-[var(--color-muted)]">
                Quick bookmarks are separate from track starts. Use listening notes above for
                detailed comments and ranges.
              </p>
            )}
            {review.data?.markers.map((marker) => (
              <div
                key={marker.id}
                className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] py-2 text-sm"
              >
                <button
                  className="min-w-0 break-words py-2 text-left hover:underline"
                  onClick={() => seek(marker.seconds - preRoll)}
                >
                  {clock(marker.seconds)} · {marker.label}
                </button>
                <button
                  className={button}
                  disabled={save.isPending}
                  aria-label={`Remove marker ${marker.label}`}
                  onClick={() =>
                    save.mutate({
                      ...review.data!,
                      markers: review.data!.markers.filter((m) => m.id !== marker.id),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </details>
      </div>
      <div hidden={section !== 'exports'}>
        <RecordingExportPanel
          id={id}
          ready={mix.session.state === 'Ready' && !mix.missing}
          busy={!!recorder.data?.busy}
        />
      </div>
      <div hidden={section !== 'tracklist'}>
        <RecordingTracklistPanel
          id={id}
          position={position}
          seek={seek}
          live={!!live && recorder.data?.session?.state === 'Recording'}
          canSetStart={!disabled}
        />
        <ReviseRecordingPlan id={id} title={mix.session.title} />
      </div>
    </section>
  )
}
