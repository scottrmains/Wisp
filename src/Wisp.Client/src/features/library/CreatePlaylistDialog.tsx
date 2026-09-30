import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { playlists as playlistsApi } from '../../api/playlists'
import type { PlaylistSummary } from '../../api/types'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { StatusMessage } from '../../components/ui/StatusMessage'

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
    <Modal labelledBy="create-playlist-title" onClose={onClose} dismissOnBackdrop className="max-w-sm p-5">
        <h2 id="create-playlist-title" className="ui-dialog-heading">{title}</h2>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          Group tracks for a set, arrange their order or use them in a mix plan. Your audio files stay in the library.
        </p>

        <input
          autoFocus
          aria-label="Playlist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          maxLength={200}
          placeholder="Playlist name"
          className="mt-3 w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
        />

        {create.isError && (
          <StatusMessage tone="error">{(create.error as Error).message}</StatusMessage>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button variant="primary"
            onClick={submit}
            disabled={!name.trim() || create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </div>
    </Modal>
  )
}
