import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { playlists as playlistsApi } from '../../api/playlists'

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
      const res = await playlistsApi.addTracksBulk(id, trackIds)
      return { name, ...res }
    },
    onSuccess: ({ name, added, skipped }) => {
      invalidate()
      onAdded?.(name, added, skipped)
      onClose()
    },
  })

  const createAndAdd = useMutation({
    mutationFn: async (name: string) => {
      const created = await playlistsApi.create(name)
      const res = await playlistsApi.addTracksBulk(created.id, trackIds)
      return { name: created.name, ...res }
    },
    onSuccess: ({ name, added, skipped }) => {
      invalidate()
      onAdded?.(name, added, skipped)
      onClose()
    },
  })

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) return
    createAndAdd.mutate(name)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-2xl">
        <h2 className="text-base font-semibold">
          Add {trackIds.length} {trackIds.length === 1 ? 'track' : 'tracks'} to a playlist
        </h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Tracks already in the chosen playlist are skipped silently.
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
                  disabled={addToExisting.isPending}
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
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
              placeholder="New playlist name"
              autoFocus
              className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-sm focus:border-[var(--color-accent)] focus:outline-none"
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || createAndAdd.isPending}
              className="rounded bg-[var(--color-accent)] px-3 py-1 text-sm font-medium text-white disabled:opacity-50"
            >
              {createAndAdd.isPending ? 'Creating…' : `Create + add ${trackIds.length}`}
            </button>
          </div>
        </div>

        {(addToExisting.isError || createAndAdd.isError) && (
          <p className="mt-2 text-xs text-red-400">
            {((addToExisting.error ?? createAndAdd.error) as Error)?.message}
          </p>
        )}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
