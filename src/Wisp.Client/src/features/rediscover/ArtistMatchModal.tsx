import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { artists } from '../../api/artists'
import type { ArtistCandidate, ArtistSummary } from '../../api/types'

interface Props {
  artist: ArtistSummary
  onClose: () => void
  onMatched: () => void
}

export function ArtistMatchModal({ artist, onClose, onMatched }: Props) {
  const qc = useQueryClient()
  const candidates = useQuery({
    queryKey: ['match-candidates', artist.id],
    queryFn: () => artists.matchCandidates(artist.id),
  })

  const assign = useMutation({
    mutationFn: (c: ArtistCandidate) => artists.assignMatch(artist.id, c.source, c.externalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artists'] })
      onMatched()
    },
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-full w-full max-w-md flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex items-start justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Match “{artist.name}”</h2>
            <p className="text-xs text-[var(--color-muted)]">
              Pick the right Spotify artist. Wrong picks recommend nonsense.
            </p>
          </div>
          <button onClick={onClose} className="text-xl leading-none text-[var(--color-muted)] hover:text-white">
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {candidates.isLoading && <p className="px-5 py-4 text-sm text-[var(--color-muted)]">Searching Spotify…</p>}
          {candidates.error && (
            <p className="px-5 py-4 text-sm text-red-400">{(candidates.error as Error).message}</p>
          )}
          {candidates.data && candidates.data.length === 0 && (
            <p className="px-5 py-4 text-sm text-[var(--color-muted)]">No matches found.</p>
          )}
          <ul>
            {candidates.data?.map((c) => (
              <li key={c.externalId} className="flex items-center gap-3 border-b border-[var(--color-border)]/40 px-5 py-3">
                {c.imageUrl ? (
                  <img src={c.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-full" />
                ) : (
                  <div className="h-12 w-12 shrink-0 rounded-full bg-[var(--color-surface)]" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-[var(--color-muted)]">
                    {c.followers !== null && `${c.followers.toLocaleString()} followers`}
                    {c.genres.length > 0 && ` · ${c.genres.slice(0, 3).join(', ')}`}
                  </p>
                </div>
                <button
                  onClick={() => assign.mutate(c)}
                  disabled={assign.isPending}
                  className="shrink-0 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  Use this
                </button>
              </li>
            ))}
          </ul>
        </div>

        <footer className="border-t border-[var(--color-border)] px-5 py-3 text-xs text-[var(--color-muted)]">
          Don't see them? Try editing the artist tag in your tracks first, then re-scan.
        </footer>
      </div>
    </div>
  )
}
