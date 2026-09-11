import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import type { Track } from '../../api/types'
import { tracks } from '../../api/library'
import { bridge, bridgeAvailable } from '../../bridge'
import { useAudioFiles } from '../../audio/audioFiles'
import { usePlayer } from '../../state/player'

type Target = { track: Track; mode: 'relink' | 'remove' }
// Shared entry point for library rows, prep workspace and playback errors.
// eslint-disable-next-line react-refresh/only-export-components
export const useTrackFileDialog = create<{ target: Target | null; open: (track: Track, mode: Target['mode']) => void; close: () => void }>((set) => ({
  target: null, open: (track, mode) => set({ target: { track, mode } }), close: () => set({ target: null }),
}))

export function TrackFileDialog() {
  const target = useTrackFileDialog((s) => s.target)
  return target ? <FileDialog key={`${target.track.id}:${target.mode}`} {...target} /> : null
}

function FileDialog({ track, mode }: Target) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [path, setPath] = useState('')
  const [picking, setPicking] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  const close = useTrackFileDialog((s) => s.close)
  const qc = useQueryClient()
  const removing = mode === 'remove'
  const mutation = useMutation({
    mutationFn: async () => removing ? tracks.remove(track.id) : tracks.relink(track.id, path.trim(), track.filePath),
    onSuccess: async (updated) => {
      const player = usePlayer.getState()
      if (player.trackId === track.id) {
        if (removing) player.clear()
        else { player._commands?.pause(); player._consumePendingPlay() }
      }
      useAudioFiles.getState().refresh(track.id)
      if (updated) qc.setQueryData(['track', track.id], updated)
      else qc.removeQueries({ queryKey: ['track', track.id], exact: true })
      // Playlists, mix plans, wanted matches and recommendations also hold track DTOs.
      await qc.invalidateQueries()
      setFinished(true)
    },
  })
  const busy = mutation.isPending || picking
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current!
    el.showModal()
    return () => { el.close(); previous?.focus() }
  }, [])

  const browse = async () => {
    setPicking(true)
    setPickError(null)
    try {
      const folder = track.filePath.replace(/[/\\][^/\\]*$/, '')
      const result = await bridge.pickAudioFile(folder)
      if (result.path) { setPath(result.path); mutation.reset() }
    } catch (e) { setPickError((e as Error).message) }
    finally { setPicking(false) }
  }

  return (
    <dialog ref={dialog} aria-labelledby="track-file-heading" aria-describedby="track-file-description"
      onCancel={(e) => { e.preventDefault(); if (!busy) close() }}
      onKeyDown={(e) => e.stopPropagation()}
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-text)] shadow-2xl backdrop:bg-black/70">
      <h2 id="track-file-heading" className="text-base font-semibold">{finished ? removing ? 'Removed from WISP' : 'Audio file relinked' : removing ? 'Remove track from WISP?' : 'Relink audio file'}</h2>
      <p className="mt-2 break-words text-sm font-medium">{track.artist ? `${track.artist} — ` : ''}{track.title ?? track.fileName}</p>
      <p id="track-file-description" className="mt-3 text-sm text-[var(--color-muted)]">
        {finished ? removing
          ? 'The library entry was removed. Your music file has not been deleted or moved.'
          : 'The replacement is linked. Playback and waveform have been refreshed. Your cues, notes, tags and playlist entries are preserved. Check cue timing before your next set.'
          : removing
            ? 'This removes the track from playlists and mix plans and deletes its WISP cues, device cues, tags and notes. Your music file stays on disk. A later folder scan can import it again as a new entry. Use Archive instead if you want to keep your prep data.'
            : 'Choose the replacement for this track. WISP will check that it decodes before saving the link. Existing metadata, cues, notes, tags and playlist entries are kept. Cue times are not adjusted: check them if the version, intro or length differs.'}
      </p>
      {!finished && <>
        <p className="mt-4 text-xs text-[var(--color-muted)]">Currently linked file</p>
        <p className="mt-1 break-all rounded border border-[var(--color-border)] p-2 text-xs">{track.filePath}</p>
        {!removing && <div className="mt-4">
          <label htmlFor="replacement-file" className="text-sm">Replacement audio file</label>
          <div className="mt-2 flex flex-wrap gap-2">
            <input id="replacement-file" value={path} maxLength={32767} disabled={busy} onChange={(e) => { setPath(e.target.value); mutation.reset() }}
              placeholder="D:\Music\replacement.aiff" className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-sm" />
            {bridgeAvailable() && <button type="button" disabled={busy} onClick={() => void browse()} className="rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50">Browse…</button>}
          </div>
          <p className="mt-2 text-xs text-[var(--color-muted)]">Files stay in their current location. Nothing is copied or overwritten.</p>
        </div>}
        {(mutation.error || pickError) && <p role="alert" className="mt-3 break-words text-sm text-red-300">{mutation.error?.message ?? pickError}</p>}
        {mutation.isPending && <p role="status" className="mt-3 text-sm text-[var(--color-muted)]">{removing ? 'Removing library entry…' : 'Checking the full audio file and saving the link…'}</p>}
      </>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button autoFocus disabled={busy} onClick={close} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-50">{finished ? 'Done' : 'Cancel'}</button>
        {!finished && <button disabled={busy || (!removing && !path.trim())} onClick={() => mutation.mutate()}
          className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${removing ? 'bg-red-700' : 'bg-[var(--color-accent)]'}`}>
          {removing ? 'Remove from WISP' : 'Validate and relink'}
        </button>}
      </div>
    </dialog>
  )
}
