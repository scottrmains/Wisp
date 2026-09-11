import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { playlists } from '../../api/playlists'

export interface PlaylistRemoval { playlistId: string; playlistName: string; entryIds: string[] }

export function RemoveFromPlaylistDialog({ target, onClose, onRemoved }: {
  target: PlaylistRemoval; onClose: () => void; onRemoved: (count: number) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: () => playlists.removeEntries(target.playlistId, target.entryIds),
    onSuccess: async result => {
      await qc.invalidateQueries()
      onRemoved(result.removed); onClose()
    },
  })
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current!
    el.showModal()
    return () => { el.close(); previous?.focus() }
  }, [])
  return <dialog ref={dialog} aria-labelledby="playlist-remove-title"
    onCancel={e => { e.preventDefault(); if (!remove.isPending) onClose() }} onKeyDown={e => e.stopPropagation()}
    className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-text)] shadow-2xl backdrop:bg-black/70">
    <h2 id="playlist-remove-title" className="text-base font-semibold">Remove from playlist?</h2>
    <p className="mt-3 break-words text-sm">Remove {target.entryIds.length} selected {target.entryIds.length === 1 ? 'entry' : 'entries'} from “{target.playlistName}”?</p>
    <p className="mt-3 text-sm text-[var(--color-muted)]">Your music files, library tracks, cues and other playlists stay unchanged. Only the selected entries are removed; unselected repeats stay in this playlist.</p>
    {remove.error && <p role="alert" className="mt-3 text-sm text-red-300">{remove.error.message}</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button disabled={remove.isPending} onClick={onClose} className="rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50">Cancel</button>
      <button disabled={remove.isPending} onClick={() => remove.mutate()} className="rounded bg-[var(--color-accent)] px-3 py-2 text-sm text-white disabled:opacity-50">{remove.isPending ? 'Removing…' : 'Remove from playlist'}</button>
    </div>
  </dialog>
}
