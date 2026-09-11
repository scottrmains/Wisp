import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { playlists as playlistsApi } from '../../api/playlists'
import { addTracksToPlaylist } from './addTracksToPlaylist'

interface Props {
  trackIds: string[]
  onClose: () => void
  onAdded?: (playlistName: string, added: number, skipped: number) => void
}

/// Modal for adding one or many tracks to a playlist. Two paths from the same UI:
///   - pick an existing playlist from the list
///   - type a name + create a new one in the same step (then the tracks land in it)
export function AddToPlaylistDialog({ trackIds, onClose, onAdded }: Props) {
  const qc = useQueryClient()
  const [newName, setNewName] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const createdPlaylist = useRef<{ id: string; name: string } | null>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current!
    el.showModal()
    return () => { el.close(); previous?.focus() }
  }, [])

  const list = useQuery({
    queryKey: ['playlists'],
    queryFn: () => playlistsApi.list(),
    staleTime: 30_000,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['playlists'] })
    qc.invalidateQueries({ queryKey: ['tracks'] })
  }

  const addToExisting = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await addTracksToPlaylist(id, trackIds)
      return res ? { name, ...res } : null
    },
    onSuccess: (result) => {
      if (!result) return
      const { name, added, skipped } = result
      invalidate()
      onAdded?.(name, added, skipped)
      onClose()
    },
  })

  const createAndAdd = useMutation({
    mutationFn: async (name: string) => {
      // If creation succeeded but adding failed, retry that same playlist.
      const created = createdPlaylist.current?.name === name ? createdPlaylist.current : await playlistsApi.create(name)
      createdPlaylist.current = created
      void qc.invalidateQueries({ queryKey: ['playlists'] })
      const res = await addTracksToPlaylist(created.id, trackIds)
      return res ? { name: created.name, ...res } : null
    },
    onSuccess: (result) => {
      if (!result) return
      const { name, added, skipped } = result
      invalidate()
      onAdded?.(name, added, skipped)
      onClose()
    },
  })

  const busy = addToExisting.isPending || createAndAdd.isPending
  const handleCreate = () => {
    const name = newName.trim()
    if (!name || busy) return
    createAndAdd.mutate(name)
  }

  return (
    <dialog ref={dialog} aria-labelledby="add-playlist-title"
      onCancel={e => { e.preventDefault(); if (!busy) onClose() }} onKeyDown={e => e.stopPropagation()}
      className="m-auto max-h-[85vh] w-[min(28rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-5 text-[var(--color-text)] shadow-2xl backdrop:bg-black/70">
        <h2 id="add-playlist-title" className="text-base font-semibold">
          Add {trackIds.length} {trackIds.length === 1 ? 'track' : 'tracks'} to a playlist
        </h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          If a track is already in the playlist, you can add it again, skip existing tracks, or cancel.
        </p>

        <div className="mt-3">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Existing playlists</p>
          <ul className="max-h-56 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)]">
            {list.isLoading && (
              <li className="px-3 py-2 text-xs text-[var(--color-muted)]">Loading…</li>
            )}
            {list.data && list.data.length === 0 && (
              <li className="px-3 py-2 text-xs text-[var(--color-muted)]">
                No playlists yet — create one below.
              </li>
            )}
            {(list.data ?? []).map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => addToExisting.mutate({ id: p.id, name: p.name })}
                  disabled={busy}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-muted)]">
                    {p.trackCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-4">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Or create a new one</p>
          <div className="flex gap-2">
            <input
              value={newName}
              disabled={busy}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              placeholder="New playlist name"
              autoFocus
              className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm focus:border-[var(--color-accent)] focus:outline-none"
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || busy}
              className="rounded bg-[var(--color-accent)] px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
            >
              {createAndAdd.isPending ? 'Creating…' : `Create + add ${trackIds.length}`}
            </button>
          </div>
        </div>

        {(addToExisting.isError || createAndAdd.isError) && (
          <p role="alert" className="mt-2 text-xs text-red-400">
            {((addToExisting.error ?? createAndAdd.error) as Error)?.message}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-white"
          >
            Cancel
          </button>
        </div>
    </dialog>
  )
}
