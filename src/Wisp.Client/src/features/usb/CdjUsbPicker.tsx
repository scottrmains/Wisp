import { useEffect, useId, useRef, useState } from 'react'
import { CircleCheck, HardDrive, RefreshCw, TriangleAlert, Usb, X } from 'lucide-react'
import { cdjExport, type CdjUsbDevice } from '../../api/cdjExport'

const size = (bytes: number) => `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`

export function CdjUsbPicker({ sourceName, onChoose, onClose }: {
  sourceName: string
  onChoose: (device: CdjUsbDevice) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [devices, setDevices] = useState<CdjUsbDevice[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const selected = devices.find(device => device.deviceId === selectedId)
  const selectionLost = !!selectedId && !selected

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current!
    element.showModal()
    return () => { element.close(); previous?.focus() }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      setLoading(true)
      setError('')
      try {
        const connected = await cdjExport.devices(controller.signal)
        if (!controller.signal.aborted) setDevices(connected)
      } catch (cause) {
        if (!controller.signal.aborted) {
          setDevices([])
          setError(cause instanceof Error ? cause.message : 'USB detection failed. Reconnect the device and refresh.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          timer = setTimeout(() => void refresh(), 15000)
        }
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [revision])

  return <dialog ref={dialog} aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); onClose() }} onKeyDown={event => event.stopPropagation()}
    className="m-auto w-[min(32rem,calc(100vw-2rem))] max-h-[85vh] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-6 text-[var(--color-text)] shadow-2xl backdrop:bg-black/70">
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]"><Usb size={15} aria-hidden="true" /> CDJ USB export</p>
        <h2 id={`${id}-title`} className="text-xl font-semibold">Choose your USB</h2>
        <p className="mt-1 break-words text-sm text-[var(--color-muted)]">{sourceName}</p>
      </div>
      <button type="button" onClick={onClose} aria-label="Close USB selector" className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-[var(--color-border)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"><X size={18} /></button>
    </header>

    <div className="mt-6 flex items-center justify-between gap-3">
      <label htmlFor={`${id}-device`} className="text-sm font-medium">Connected USB</label>
      <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}
        className="flex min-h-11 items-center gap-2 rounded px-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]">
        <RefreshCw size={14} aria-hidden="true" /> {loading ? 'Checking…' : 'Refresh'}
      </button>
    </div>
    <select id={`${id}-device`} value={selected?.deviceId ?? ''} onChange={event => setSelectedId(event.target.value)} disabled={loading || !devices.length}
      aria-describedby={`${id}-status`}
      className="min-h-11 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-60">
      <option value="">{loading ? 'Checking connected USBs…' : devices.length ? 'Select a USB device' : 'No USB device found'}</option>
      {devices.map(device => <option key={device.deviceId} value={device.deviceId}>
        {device.label} ({device.rootPath}) · {size(device.sizeBytes)}{device.canExport ? '' : ' · Needs preparation'}
      </option>)}
    </select>

    <div id={`${id}-status`} className="mt-4" aria-live="polite">
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : selectionLost ?
        <p role="alert" className="text-sm text-amber-200">The selected USB was disconnected or changed. Select it again; WISP will not switch to another drive automatically.</p> :
        !loading && devices.length === 0 ? <div className="py-4 text-sm text-[var(--color-muted)]">
          <HardDrive size={24} className="mb-3" aria-hidden="true" />Plug in a USB drive, then refresh. Only mounted USB storage is listed—your internal music disks stay out of this list.
        </div> : null}
      {selected && <>
        <div className="flex flex-wrap justify-between gap-3 border-b border-[var(--color-border)] pb-4 text-sm">
          <span className="min-w-0 break-words text-[var(--color-muted)]">{selected.model}</span>
          <span>{size(selected.freeBytes)} free</span>
          <span className="w-full text-xs text-[var(--color-muted)]">{selected.fileSystem || 'Unknown filesystem'} · {selected.partitionStyle} · {selected.partitionCount} {selected.partitionCount === 1 ? 'partition' : 'partitions'}</span>
        </div>
        <div className={`mt-4 flex items-start gap-3 text-sm ${selected.canExport ? 'text-[var(--color-muted)]' : 'text-amber-200'}`}>
          {selected.canExport ? <CircleCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" /> : <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />}
          <div><p className="font-medium text-[var(--color-text)]">{selected.canExport ? 'USB layout checked' : 'USB needs preparation'}</p>
            <p className="mt-1 leading-relaxed">{selected.compatibilityProblem ?? 'The drive layout meets this export profile. Tracks, cue data and free space are checked next.'}</p>
          </div>
        </div>
      </>}
    </div>
    <p className="mt-6 text-xs leading-relaxed text-[var(--color-muted)]">CDJ-850 / original CDJ-900 · Memory Cue test build. Reference catalogue tracks remain visible; waveforms are not generated. WISP never formats or repartitions your USB.</p>
    <footer className="mt-5 flex justify-end gap-3">
      <button type="button" onClick={onClose} className="min-h-11 rounded border border-[var(--color-border)] px-4 text-sm">Cancel</button>
      <button type="button" disabled={!selected?.canExport || loading || !!error} onClick={() => { if (selected?.canExport) onChoose(selected) }}
        className="min-h-11 rounded bg-[var(--color-accent)] px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]">Review export</button>
    </footer>
  </dialog>
}
