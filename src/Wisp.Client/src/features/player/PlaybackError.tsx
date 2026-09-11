import type { Track } from '../../api/types'
import { useAudioFiles } from '../../audio/audioFiles'
import { useTrackFileDialog } from '../library/TrackFileDialog'

export function PlaybackError({ track, error }: { track: Track; error: string | null }) {
  if (!error && !track.isUnavailable) return null
  return <div className="mx-3 my-2 flex flex-wrap items-center gap-3 rounded-md border border-amber-700/50 bg-amber-950/20 p-3 text-sm">
    <p role="alert" className="min-w-0 flex-1 basis-64 break-words text-amber-200">{error ?? 'This file was missing at the last scan. Reconnect its drive or relink it to a replacement.'}</p>
    <button onClick={() => useAudioFiles.getState().refresh(track.id)} className="rounded border border-[var(--color-border)] px-3 py-1.5">Retry audio</button>
    <button onClick={() => useTrackFileDialog.getState().open(track, 'relink')} className="rounded bg-[var(--color-accent)] px-3 py-1.5 text-white">Relink audio file…</button>
  </div>
}
