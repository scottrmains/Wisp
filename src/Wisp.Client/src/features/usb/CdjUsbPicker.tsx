import { useEffect, useId, useState } from 'react'
import { CircleCheck, HardDrive, RefreshCw, TriangleAlert, Usb, X } from 'lucide-react'
import { cdjExport, type CdjUsbDevice } from '../../api/cdjExport'
import { Modal } from '../../components/ui/Modal'
import { Button, IconButton } from '../../components/ui/Button'

const size = (bytes: number) =>
  `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`

export function CdjUsbPicker({
  sourceName,
  onChoose,
  onClose,
}: {
  sourceName: string
  onChoose: (device: CdjUsbDevice) => void
  onClose: () => void
}) {
  const id = useId()
  const [devices, setDevices] = useState<CdjUsbDevice[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const selected = devices.find((device) => device.deviceId === selectedId)
  const selectionLost = !!selectedId && !selected

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
          setError(
            cause instanceof Error
              ? cause.message
              : 'USB detection failed. Reconnect the device and refresh.',
          )
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          timer = setTimeout(() => void refresh(), 15000)
        }
      }
    }
    void refresh()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [revision])

  return (
    <Modal labelledBy={`${id}-title`} onClose={onClose} className="p-5">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
            <Usb size={15} aria-hidden="true" /> CDJ USB export
          </p>
          <h2 id={`${id}-title`} className="ui-dialog-heading">
            Choose your USB
          </h2>
          <p className="mt-1 break-words text-sm text-[var(--color-muted)]">{sourceName}</p>
        </div>
        <IconButton onClick={onClose} label="Close USB selector" variant="quiet">
          <X />
        </IconButton>
      </header>

      <div className="mt-6 flex items-center justify-between gap-3">
        <label htmlFor={`${id}-device`} className="text-sm font-medium">
          Connected USB
        </label>
        <Button
          small
          variant="quiet"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw size={14} aria-hidden="true" /> {loading ? 'Checking…' : 'Refresh'}
        </Button>
      </div>
      <select
        id={`${id}-device`}
        value={selected?.deviceId ?? ''}
        onChange={(event) => setSelectedId(event.target.value)}
        disabled={loading || !devices.length}
        aria-describedby={`${id}-status`}
        className="min-h-11 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] disabled:opacity-60"
      >
        <option value="">
          {loading
            ? 'Checking connected USBs…'
            : devices.length
              ? 'Select a USB device'
              : 'No USB device found'}
        </option>
        {devices.map((device) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label} ({device.rootPath}) · {size(device.sizeBytes)}
            {device.canExport ? '' : ' · Needs preparation'}
          </option>
        ))}
      </select>

      <div id={`${id}-status`} className="mt-4" aria-live="polite">
        {error ? (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        ) : selectionLost ? (
          <p role="alert" className="text-sm text-amber-200">
            The selected USB was disconnected or changed. Select it again; WISP will not switch to
            another drive automatically.
          </p>
        ) : !loading && devices.length === 0 ? (
          <div className="py-4 text-sm text-[var(--color-muted)]">
            <HardDrive size={24} className="mb-3" aria-hidden="true" />
            Plug in a USB drive, then refresh. Only mounted USB storage is listed—your internal
            music disks stay out of this list.
          </div>
        ) : null}
        {selected && (
          <>
            <div className="flex flex-wrap justify-between gap-3 border-b border-[var(--color-border)] pb-4 text-sm">
              <span className="min-w-0 break-words text-[var(--color-muted)]">
                {selected.model}
              </span>
              <span>{size(selected.freeBytes)} free</span>
              <span className="w-full text-xs text-[var(--color-muted)]">
                {selected.fileSystem || 'Unknown filesystem'} · {selected.partitionStyle} ·{' '}
                {selected.partitionCount}{' '}
                {selected.partitionCount === 1 ? 'partition' : 'partitions'}
              </span>
            </div>
            <div
              className={`mt-4 flex items-start gap-3 text-sm ${selected.canExport ? 'text-[var(--color-muted)]' : 'text-amber-200'}`}
            >
              {selected.canExport ? (
                <CircleCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              ) : (
                <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <div>
                <p className="font-medium text-[var(--color-text)]">
                  {selected.canExport ? 'USB layout checked' : 'USB needs preparation'}
                </p>
                <p className="mt-1 leading-relaxed">
                  {selected.compatibilityProblem ??
                    'The drive layout meets this export profile. Tracks, cue data and free space are checked next.'}
                </p>
              </div>
            </div>
          </>
        )}
      </div>
      <div className="mt-6 border-t border-[var(--color-border)] pt-4 text-xs leading-relaxed text-[var(--color-muted)]">
        <p>
          Exports tracks, playlists, overview waveforms and saved Memory Cues. Playback, overview
          waveforms and Memory Cues are hardware-tested on the original CDJ-900; the full CDJ-850
          profile remains unverified.
        </p>
        <details className="mt-2">
          <summary className="cursor-pointer py-2 text-[var(--color-text)]">
            Export limitations & USB safety
          </summary>
          <p>
            Open playlists prefixed WISP on the player. Extra reference catalogue entries remain
            visible and may not load. Beat grids and detailed scrolling waveforms are not included.
          </p>
          <p className="mt-2">
            This is an explicit export, not automatic syncing. Existing Pioneer libraries require a
            backup-and-replace confirmation. WISP never formats or repartitions your USB.
          </p>
        </details>
      </div>
      <footer className="mt-5 flex justify-end gap-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!selected?.canExport || loading || !!error}
          onClick={() => {
            if (selected?.canExport) onChoose(selected)
          }}
        >
          Review export
        </Button>
      </footer>
    </Modal>
  )
}
