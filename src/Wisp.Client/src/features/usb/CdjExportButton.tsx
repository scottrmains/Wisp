import { HardDriveUpload } from 'lucide-react'
import { lazy, Suspense, useRef, useState } from 'react'
import { cdjExport, type CdjExportSource, type CdjUsbDevice } from '../../api/cdjExport'
import { bridgeAvailable } from '../../bridge'
import { alertDialog, confirmDialog } from '../../components/dialog'
const CdjUsbPicker = lazy(() => import('./CdjUsbPicker').then(module => ({ default: module.CdjUsbPicker })))

interface Props {
  source: CdjExportSource
  sourceId: string
  sourceName: string
  disabled?: boolean
  className?: string
}

// A preserved player-accepted database is still used as a read-only template.
// CDJ-900 playlist playback, overview waveforms and Memory Cues are hardware-confirmed.

/// A deliberately prominent export entry point. The server performs the
/// format/capacity checks again during the actual write; this preflight makes
/// the important failures visible before the user confirms a USB change.
export function CdjExportButton({ source, sourceId, sourceName, disabled = false, className = '' }: Props) {
  const [exporting, setExporting] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const inFlight = useRef(false)
  const exportToCdj = async (device: CdjUsbDevice) => {
    if (!bridgeAvailable()) return

    const preflight = await cdjExport.preflight(source, sourceId, device.rootPath, device.deviceId)
    if (preflight.missingFiles.length || preflight.unsupportedFiles.length) {
      await alertDialog({
        title: 'CDJ export needs attention',
        message: `${preflight.missingFiles.length} missing file(s) and ${preflight.unsupportedFiles.length} unsupported file(s) were found. All selected tracks must be MP3, AAC, WAV or AIFF.`,
        tone: 'error',
      })
      return
    }
    if (preflight.requiredBytes > preflight.availableBytes) {
      await alertDialog({
        title: 'Not enough USB space',
        message: 'CDJ export was not started because the selected USB does not have enough available space.',
        tone: 'error',
      })
      return
    }

    const approved = await confirmDialog(preflight.needsPioneerReplacement
      ? {
        title: 'Replace the Pioneer library?',
        message: 'This replaces the USB’s current Pioneer library with this export, not an incremental sync. WISP first backs up PIONEER and its previous exported audio under WISP/backups. Use the playlists prefixed WISP on the player: leftover reference entries are still listed and may not load.',
        confirmLabel: 'Back up and replace',
        danger: true,
      }
      : {
        title: 'Export to CDJ USB?',
        message: `Copy ${preflight.trackCount} tracks with overview waveforms and ${preflight.deviceCueCount} Memory Cue(s) to ${device.label} (${device.rootPath}). Analysis may take a few minutes. WISP still uses a reference database, so extra reference entries may appear. On the CDJ, open the playlists prefixed WISP.`,
        confirmLabel: 'Export tracks',
      })
    if (!approved) return

    const result = await cdjExport.export(source, sourceId, device.rootPath, preflight.needsPioneerReplacement, device.deviceId)
    await alertDialog({
      title: 'CDJ export complete',
      message: `${result.trackCount} tracks and ${result.playlistCount} playlists were exported with validated overview waveforms and Memory Cue records. Safely eject the USB, then open a WISP playlist. Use CUE/LOOP CALL to recall saved cues. Playback, overview waveforms and Memory Cues have been tested on CDJ-900; the full CDJ-850 profile remains unverified. Extra reference entries remain; beat grids and detailed scrolling waveforms are not included.`,
      confirmLabel: 'Done',
    })
  }

  const startExport = async (device: CdjUsbDevice) => {
    if (inFlight.current) return
    inFlight.current = true
    setChoosing(false)
    setExporting(true)
    try {
      await exportToCdj(device)
    } catch (error) {
      await alertDialog({
        title: 'CDJ export could not complete',
        message: error instanceof Error ? error.message : 'The USB export failed. Check the reference database and USB connection, then try again.',
        tone: 'error',
      })
    } finally {
      inFlight.current = false
      setExporting(false)
    }
  }

  const unavailable = !bridgeAvailable()
  return (<>
    <button
      onClick={() => setChoosing(true)}
      disabled={disabled || unavailable || exporting || choosing}
      aria-busy={exporting}
      title={unavailable ? 'CDJ export is available in the WISP desktop app' : `Export “${sourceName}” with overview waveforms and Memory Cues`}
      className={`inline-flex items-center gap-1.5 rounded-md border border-amber-400/50 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-400/15 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      <HardDriveUpload size={14} strokeWidth={1.8} />
      {exporting ? 'Preparing CDJ export…' : 'Export to CDJ USB'}
    </button>
    {choosing && <Suspense fallback={<span role="status" className="text-xs text-[var(--color-muted)]">Loading USB selector…</span>}>
      <CdjUsbPicker sourceName={sourceName} onClose={() => setChoosing(false)} onChoose={device => void startExport(device)} />
    </Suspense>}
  </>)
}
