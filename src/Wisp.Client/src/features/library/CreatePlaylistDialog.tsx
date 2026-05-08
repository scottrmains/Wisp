import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { playlists as playlistsApi } from '../../api/playlists'
import type { PlaylistSummary } from '../../api/types'

interface Props {
  /// Optional preset name (used for "rename" mode if we ever want to reuse this shell).
  initialName?: string
  /// Header copy override — defaults to "New playlist".
  title?: string
  onClose: () => void
  onCreated?: (created: PlaylistSummary) => void
}

/// Tiny modal for creating a playlist with a typed name.
/// Replaces `window.prompt` so the styling matches the rest of the app + we can
/// validate inline (empty / too-long names get caught before the network call).
export function CreatePlaylistDialog({ initialName = '', title = 'New playlist', onClose, onCreated }: Props) {
  const qc = useQueryClient()
  const [name, setName] = useState(initialName)

  const create = useMutation({
    mutationFn: (n: string) => playlistsApi.create(n),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['playlists'] })
      onCreated?.(created)
      onClose()
    },
  })

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || create.isPending) return
    create.mutate(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-2xl">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Playlists are unordered buckets — useful for scoping mix-plan recommendations to a curated set of tracks.
        </p>

        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') onClose()
          }}
          maxLength={200}
          placeholder="Playlist name"
          className="mt-3 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
        />

        {create.isError && (
          <p className="mt-2 text-xs text-red-400">{(create.error as Error).message}</p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || create.isPending}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
