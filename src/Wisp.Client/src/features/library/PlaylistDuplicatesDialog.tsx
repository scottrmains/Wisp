import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { playlists } from '../../api/playlists'
import { ApiError } from '../../api/client'

export function PlaylistDuplicatesDialog({ playlistId, playlistName, onClose, onRemoved }: {
  playlistId: string; playlistName: string; onClose: () => void; onRemoved: (count: number) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const qc = useQueryClient()
  const scan = useQuery({
    queryKey: ['playlist-duplicates', playlistId],
    queryFn: ({ signal }) => playlists.scanDuplicates(playlistId, signal),
    retry: false, gcTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: false, refetchOnReconnect: false,
  })
  const remove = useMutation({
    mutationFn: (snapshot: string) => playlists.removeDuplicates(playlistId, snapshot),
    onSuccess: async result => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['playlists'] }),
        qc.invalidateQueries({ queryKey: ['tracks'] }),
      ])
      onRemoved(result.removed); onClose()
    },
  })
  const needsRescan = remove.error instanceof ApiError && remove.error.code === 'playlist_scan_stale'
  const result = !scan.isFetching && !scan.error ? scan.data : undefined
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const el = dialog.current!
    el.showModal()
    return () => { el.close(); previous?.focus() }
  }, [])
  const rescan = () => { remove.reset(); void scan.refetch() }

  return <dialog ref={dialog} aria-labelledby="playlist-duplicates-title"
    onCancel={e => { e.preventDefault(); if (!remove.isPending) onClose() }} onKeyDown={e => e.stopPropagation()}
    className="m-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-[var(--color-text)] shadow-2xl backdrop:bg-black/70">
    <h2 id="playlist-duplicates-title" className="text-base font-semibold">Scan playlist for duplicates</h2>
    <p className="mt-2 break-words text-sm">{playlistName}</p>
    <p className="mt-3 text-sm text-[var(--color-muted)]">Checks the entire playlist, including tracks hidden by filters. Only repeated entries of the same WISP library track count—not different files with similar titles.</p>
    {scan.isFetching && <p role="status" className="mt-4 text-sm">Scanning the whole playlist…</p>}
    {scan.error && <p role="alert" className="mt-4 text-sm text-red-300">Could not scan this playlist: {scan.error.message}</p>}
    {result && (result.duplicateEntries === 0
      ? <p role="status" className="mt-4 text-sm">No duplicates found. Checked {result.totalEntries.toLocaleString()} playlist {result.totalEntries === 1 ? 'entry' : 'entries'}.</p>
      : <>
        <p role="status" className="mt-4 text-sm">Found {result.duplicateEntries.toLocaleString()} extra {result.duplicateEntries === 1 ? 'entry' : 'entries'} across {result.groups.length.toLocaleString()} {result.groups.length === 1 ? 'track' : 'tracks'}. Remove these duplicates?</p>
        <ul aria-label="Repeated tracks" className="mt-3 max-h-48 space-y-2 overflow-y-auto rounded border border-[var(--color-border)] p-3 text-sm">
          {result.groups.map(group => <li key={group.trackId} className="break-words">
            <span>{group.artist ? `${group.artist} — ` : ''}{group.title || group.fileName}</span>
            <span className="block text-xs text-[var(--color-muted)]">{group.occurrences.toLocaleString()} entries · keep 1 · remove {(group.occurrences - 1).toLocaleString()}</span>
          </li>)}
        </ul>
        <p className="mt-3 text-sm text-[var(--color-muted)]">Keeps the oldest-added entry for each track. Music files, library tracks, cues and other playlists stay unchanged.</p>
      </>)}
    {remove.error && <p role="alert" className="mt-3 text-sm text-red-300">{remove.error.message}</p>}
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <button disabled={remove.isPending} onClick={onClose} className="rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50">{result?.duplicateEntries === 0 ? 'Close' : 'Cancel'}</button>
      {(scan.error || needsRescan) && <button disabled={scan.isFetching || remove.isPending} onClick={rescan} className="rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50">Scan again</button>}
      {!!result?.duplicateEntries && <button disabled={remove.isPending || needsRescan} onClick={() => remove.mutate(result.snapshot)}
        className="rounded bg-[var(--color-accent)] px-3 py-2 text-sm text-white disabled:opacity-50">{remove.isPending ? 'Removing…' : `Remove ${result.duplicateEntries.toLocaleString()} ${result.duplicateEntries === 1 ? 'duplicate' : 'duplicates'}`}</button>}
    </div>
  </dialog>
}
