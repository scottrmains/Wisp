import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPost } from '../../api/client'
import { useCurrentPage } from '../../state/currentPage'
import { usePlayer } from '../../state/player'
import { MixRecorderPanel } from './MixRecorderPanel'
import { useRecorderStatus } from './useRecorderStatus'
import { useRecordingNavigation } from './useRecordingTracklist'

interface InputDevice {
  id: string; name: string; mixFormat: string | null; sampleRate: number
  channels: number; canTest: boolean; unavailableReason: string | null
}
interface InputTest {
  id: string | null; state: string; deviceName: string | null; endpointId: string | null
  mixFormat: string | null; sampleRate: number; seconds: number
  leftPeak: number; rightPeak: number; leftClipped: boolean; rightClipped: boolean
  hasAudio: boolean; message: string | null; audioPath: string | null
  windowsVersion: string | null; assessment: string | null
}
const testKey = ['recording-input-test']
const active = (test?: InputTest) => !!test && ['Preparing', 'Recording', 'Finalising'].includes(test.state)
const button = 'min-h-11 rounded border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-50 disabled:cursor-not-allowed'

function useInputTest() {
  return useQuery({ queryKey: testKey, queryFn: () => apiGet<InputTest>('/api/recording-input/test'),
    refetchInterval: (query) => active(query.state.data) ? 250 : 2000 })
}

// Always mounted: a route change does not hide the fact that capture continues.
export function RecordingInputIndicator() {
  const test = useInputTest()
  const setPage = useCurrentPage(s => s.setPage)
  if (!active(test.data)) return null
  return <button className="shrink-0 border-b border-[var(--color-border)] px-4 py-2 text-left text-sm text-[var(--color-accent)]"
    onClick={() => { useRecordingNavigation.getState().record(); setPage('recordings') }}>
    ● Input test — {test.data?.state} · {Math.floor(test.data?.seconds ?? 0)} / 30s · View / stop
  </button>
}

function LevelMeter({ label, peak, clipped }: { label: string; peak: number; clipped: boolean }) {
  const db = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60
  return <div className="grid grid-cols-[1rem_1fr_5rem] items-center gap-3">
    <span className="text-sm">{label}</span>
    <div role="meter" aria-label={`${label === 'L' ? 'Left' : 'Right'} input level`}
      aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.min(0, db)}
      aria-valuetext={peak === 0 ? 'Silence' : `${db.toFixed(1)} dBFS`}
      className="h-5 overflow-hidden rounded-sm bg-[var(--color-surface)]">
      <div className={clipped ? 'h-full bg-red-500' : 'h-full bg-[var(--color-accent)]'}
        style={{ width: `${Math.min(100, (db + 60) / 60 * 100)}%` }} />
    </div>
    <span className="text-right text-xs tabular-nums">{clipped ? 'CLIPPED' : peak === 0 ? '−∞ dBFS' : `${db.toFixed(1)} dBFS`}</span>
  </div>
}

export function RecordingInputPage() {
  const mix = useRecorderStatus()
  const qc = useQueryClient()
  const test = useInputTest()
  const devices = useQuery({ queryKey: ['recording-input-devices'],
    queryFn: () => apiGet<{ devices: InputDevice[]; selectedEndpointId: string | null }>('/api/recording-input/devices') })
  const [selection, setSelection] = useState<string | null>(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const requestId = useRef<string | null>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const selectedId = selection ?? devices.data?.selectedEndpointId ?? ''
  const selected = devices.data?.devices.find(d => d.id === selectedId)
  const busy = active(test.data) || !!mix.data?.busy
  const start = useMutation({ mutationFn: async () => {
    audio.current?.pause()
    usePlayer.getState()._commands?.pause()
    requestId.current ??= crypto.randomUUID()
    return apiPost<InputTest>('/api/recording-input/test', { requestId: requestId.current, endpointId: selectedId })
  }, onSuccess: data => { requestId.current = null; qc.setQueryData(testKey, data) } })
  const stop = useMutation({ mutationFn: () => apiPost<InputTest>(`/api/recording-input/test/${test.data!.id}/stop`),
    onSuccess: data => qc.setQueryData(testKey, data) })
  const error = start.error ?? stop.error ?? test.error ?? devices.error

  return <div className="wm-record-page">
    <div className="space-y-6">
      <header hidden={!!mix.data?.busy}>
        <p className="wm-eyebrow">Recording desk</p>
        <h1 className="text-2xl font-semibold">Record your mix</h1>
        {!mix.data?.busy && <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">
          Choose your stereo input and recording folder. Use the short input test below if you need to check your routing first.
          No live monitoring, gain processing or library import.
        </p>}
      </header>

      <section aria-label="Input setup" className="space-y-3" hidden={!!mix.data?.busy}>
        <label htmlFor="recording-input" className="block text-sm font-medium">Stereo recording input</label>
        <div className="flex flex-wrap gap-2">
          <select id="recording-input" value={selectedId} disabled={busy || start.isPending || devices.isPending}
            onChange={e => { setSelection(e.target.value); requestId.current = null; start.reset() }}
            className="min-h-11 min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm">
            <option value="">Choose an input — nothing selected automatically</option>
            {selectedId && !selected && <option value={selectedId}>Saved input unavailable — reconnect it or choose another</option>}
            {devices.data?.devices.map(d => <option key={d.id} value={d.id} disabled={!d.canTest}>{d.name}{!d.canTest ? ' (unavailable for stereo test)' : ''}</option>)}
          </select>
          <button className={button} disabled={busy || devices.isFetching} onClick={() => void devices.refetch()}>
            {devices.isFetching ? 'Checking inputs…' : 'Refresh inputs'}
          </button>
        </div>
        {devices.data?.devices.length === 0 && <p className="text-sm">No recording inputs found. Connect the mixer and refresh inputs.</p>}
        {selected && <p className="text-xs text-[var(--color-muted)]">
          Windows shared format: {selected.mixFormat ?? 'Unavailable'} · {selected.channels} channels.
          {selected.unavailableReason ?? ' The test uses stereo 32-bit float WAV at this sample rate. Float describes the capture format, not hardware bit depth.'}
        </p>}
        <details className="text-sm text-[var(--color-muted)]">
          <summary className="cursor-pointer py-2">Xone:24C routing guide</summary>
          <p>In STREAM mode, MIX L/R goes to USB channels 1/2; in DVS PRO or DAW mode it goes to 5/6.
            “Input 1” is a candidate stereo pair, not a guarantee. Choose a recording input, not an output loopback.</p>
          <p className="mt-2">Play deck 1 alone, deck 2 alone, then both. Move each channel fader to confirm this is the full mix.
            Check left/right using a known stereo source. Keep software monitoring off; stop recording before listening back.</p>
        </details>
      </section>

      <MixRecorderPanel endpointId={selected?.canTest ? selectedId : ''} inputTestBusy={active(test.data)} />

      <details className="wm-input-diagnostics" open={diagnosticsOpen || active(test.data)} onToggle={e => setDiagnosticsOpen(e.currentTarget.open)} hidden={!!mix.data?.busy}><summary>Test input & routing</summary>
      <section aria-label="Input test" className="space-y-4 border-y border-[var(--color-border)] py-5">
        <h2 className="text-lg font-medium">Test your recording input</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p role="status" className="text-sm font-medium">{test.data?.state ?? 'Loading test status…'}</p>
            <p className="text-3xl tabular-nums">{(test.data?.seconds ?? 0).toFixed(1)} <span className="text-base text-[var(--color-muted)]">/ 30s</span></p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={`${button} bg-[var(--color-accent)] text-[var(--color-bg)]`}
              disabled={!selected?.canTest || busy || start.isPending || test.isPending || test.isError}
              onClick={() => start.mutate()}>{start.isPending ? 'Starting…' : 'Record 30-second test'}</button>
            <button className={button} disabled={!active(test.data) || stop.isPending} onClick={() => stop.mutate()}>Stop test</button>
          </div>
        </div>
        {active(test.data) && <p className="break-words text-sm">Capturing: {test.data?.deviceName}. Stops automatically after 30 seconds, even if you leave this page.</p>}
        <LevelMeter label="L" peak={test.data?.leftPeak ?? 0} clipped={test.data?.leftClipped ?? false} />
        <LevelMeter label="R" peak={test.data?.rightPeak ?? 0} clipped={test.data?.rightClipped ?? false} />
        {(test.data?.leftClipped || test.data?.rightClipped) && <p className="text-sm text-red-400">Clipping detected during this test. Lower the level feeding the recording input and try again.</p>}
        <p className="text-xs text-[var(--color-muted)]">Short diagnostic clips only. This test does not use the full recorder’s checkpoint recovery. Keep WISP open until the test finishes.</p>
      </section>

      {(error || test.data?.message) && <p role="alert" className="text-sm text-red-400">{error?.message ?? test.data?.message}</p>}
      {test.data?.hasAudio && !busy && <section aria-label="Test playback" className="space-y-3">
        <h2 className="text-lg font-medium">Listen back before confirming the input</h2>
        <p className="text-sm">{test.data.deviceName} · {test.data.sampleRate.toLocaleString()} Hz · stereo float WAV</p>
        <audio ref={audio} key={test.data.id} controls preload="metadata" className="w-full"
          aria-label="Input test playback" src={`/api/recording-input/test/${test.data.id}/audio`}
          onPlay={() => usePlayer.getState()._commands?.pause()} />
        <p className="break-all text-xs text-[var(--color-muted)]">Saved outside your library: {test.data.audioPath}</p>
        {test.data.state === 'Ready' && <Assessment key={test.data.id} test={test.data} />}
      </section>}
      </details>
    </div>
  </div>
}

function Assessment({ test }: { test: InputTest }) {
  const qc = useQueryClient()
  const [notes, setNotes] = useState(test.assessment ?? '')
  const save = useMutation({ mutationFn: () => apiPost<InputTest>(`/api/recording-input/test/${test.id}/assessment`, { notes }),
    onSuccess: data => qc.setQueryData(testKey, data) })
  return <div className="space-y-2">
    <label htmlFor="input-observations" className="block text-sm font-medium">Routing observations</label>
    <p className="text-xs text-[var(--color-muted)]">Note the mixer USB mode and driver version, whether both decks and faders were captured, and whether left/right played correctly. Saving notes does not automatically certify the input.</p>
    <textarea id="input-observations" rows={3} maxLength={4000} value={notes}
      onChange={e => { setNotes(e.target.value); save.reset() }}
      className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm" />
    <button className={button} disabled={!notes.trim() || save.isPending} onClick={() => save.mutate()}>
      {save.isPending ? 'Saving…' : 'Save observations'}
    </button>
    {save.isSuccess && <p role="status" className="text-sm">Observations saved with this test’s endpoint, capture format and Windows version.</p>}
    {save.error && <p role="alert" className="text-sm text-red-400">{save.error.message}</p>}
  </div>
}
