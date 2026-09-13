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

// A removable-drive export uses a separate player-accepted Pioneer USB as a
// read-only database template. The template USB is never modified.
const directCdjExportAvailable = true

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
        message: 'WISP will back up the existing PIONEER directory under WISP/backups, then install the test library with audio-derived overview waveforms and Memory Cues. This diagnostic still retains the reference catalogue. On the player, use the playlist prefixed WISP; other reference tracks may not load.',
        confirmLabel: 'Back up and replace',
        danger: true,
      }
      : {
        title: 'Run CDJ waveform and cue test?',
        message: `WISP will copy ${preflight.trackCount} tracks, analyze their audio for overview waveforms and write ${preflight.deviceCueCount} WISP Memory Cue(s). Analysis may take a few minutes. This test retains the template catalogue; on the CDJ, open the WISP playlist and check its waveforms and Memory Cues.`,
        confirmLabel: 'Create test USB',
      })
    if (!approved) return

    const result = await cdjExport.export(source, sourceId, device.rootPath, preflight.needsPioneerReplacement, device.deviceId)
    await alertDialog({
      title: 'CDJ waveform and cue test USB created',
      message: `${result.trackCount} tracks and ${result.playlistCount} playlists were exported with validated overview waveforms and cue records. Safely eject the USB, open the playlist prefixed WISP on the CDJ and check the overview waveform. Use CUE/LOOP CALL to check saved timestamps. Waveform display and Memory Cue recall still need hardware verification. Extra reference tracks remain; beat grids and detailed scrolling waveforms are not included.`,
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
  const unavailableForHardware = !directCdjExportAvailable
  return (<>
    <button
      onClick={() => setChoosing(true)}
      disabled={disabled || unavailable || unavailableForHardware || exporting || choosing}
      aria-busy={exporting}
      title={unavailableForHardware
        ? 'Direct CDJ-850 export is disabled until it passes the physical-device compatibility test.'
        : unavailable ? 'CDJ export is available in the WISP desktop app' : `Run the CDJ-850 hardware-validation export for “${sourceName}”`}
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
