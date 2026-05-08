import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { artists } from '../../api/artists'
import type { ArtistSummary, ExternalRelease } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { ArtistMatchModal } from './ArtistMatchModal'

interface Props {
  onClose: () => void
}

export function RediscoverScreen({ onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [matchTarget, setMatchTarget] = useState<ArtistSummary | null>(null)

  const list = useQuery({
    queryKey: ['artists'],
    queryFn: () => artists.list(),
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const selected = list.data?.find((a) => a.id === selectedId) ?? null

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--color-bg)]">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Rediscover</h1>
          <p className="text-xs text-[var(--color-muted)]">
            See what your favourite artists released since you last checked.
          </p>
        </div>
        <button onClick={onClose} className="text-[var(--color-muted)] hover:text-white" aria-label="Close">
          ×
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <ArtistList
          artists={list.data ?? []}
          loading={list.isLoading}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onMatch={setMatchTarget}
        />
        <div className="min-h-0 flex-1 overflow-y-auto border-l border-[var(--color-border)]">
          {selected ? (
            <ArtistDetail artist={selected} onMatch={() => setMatchTarget(selected)} />
          ) : (
            <p className="p-8 text-sm text-[var(--color-muted)]">Pick an artist on the left to see what they've released.</p>
          )}
        </div>
      </div>

      {matchTarget && (
        <ArtistMatchModal
          artist={matchTarget}
          onClose={() => setMatchTarget(null)}
          onMatched={() => {
            setMatchTarget(null)
            // refetch happens via mutation onSuccess
          }}
        />
      )}
    </div>
  )
}

function ArtistList({
  artists: list,
  loading,
  selectedId,
  onSelect,
  onMatch,
}: {
  artists: ArtistSummary[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onMatch: (artist: ArtistSummary) => void
}) {
  return (
    <aside className="w-[22rem] shrink-0 overflow-y-auto">
      {loading && <p className="p-4 text-sm text-[var(--color-muted)]">Loading artists…</p>}
      {!loading && list.length === 0 && (
        <p className="p-4 text-sm text-[var(--color-muted)]">
          No artists in your library yet. Scan a folder first.
        </p>
      )}
      <ul>
        {list.map((a) => (
          <li
            key={a.id}
            className={[
              'cursor-pointer border-b border-[var(--color-border)]/40 px-4 py-2.5 text-sm hover:bg-white/5',
              selectedId === a.id ? 'bg-[var(--color-accent)]/10' : '',
            ].join(' ')}
            onClick={() => onSelect(a.id)}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{a.name}</span>
              {a.newReleaseCount > 0 && (
                <span className="rounded-full bg-[var(--color-accent)]/20 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                  +{a.newReleaseCount}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <span>{a.trackCount} local</span>
              {a.latestLocalYear !== null && <span>· latest {a.latestLocalYear}</span>}
              {!a.isMatched && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onMatch(a)
                  }}
                  className="ml-auto text-[var(--color-accent)] hover:underline"
                >
                  match
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function ArtistDetail({ artist, onMatch }: { artist: ArtistSummary; onMatch: () => void }) {
  const qc = useQueryClient()
  const releases = useQuery({
    queryKey: ['releases', artist.id, 'new'],
    queryFn: () => artists.releases(artist.id, 'new'),
    enabled: artist.isMatched,
  })

  const refresh = useMutation({
    mutationFn: () => artists.refresh(artist.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['releases', artist.id] })
      qc.invalidateQueries({ queryKey: ['artists'] })
    },
  })

  if (!artist.isMatched) {
    return (
      <div className="p-8">
        <h2 className="text-xl font-semibold">{artist.name}</h2>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {artist.trackCount} local tracks
          {artist.latestLocalYear !== null && ` · latest from ${artist.latestLocalYear}`}
        </p>
        <p className="mt-6 text-sm">
          This artist isn't matched on Spotify yet. Click below to find them.
        </p>
        <button
          onClick={onMatch}
          className="mt-3 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white"
        >
          Find on Spotify
        </button>
      </div>
    )
  }

  return (
    <div className="p-6">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{artist.name}</h2>
          <p className="text-sm text-[var(--color-muted)]">
            {artist.trackCount} local
            {artist.latestLocalYear !== null && ` · latest ${artist.latestLocalYear}`}
            {artist.lastCheckedAt && ` · last checked ${new Date(artist.lastCheckedAt).toLocaleDateString()}`}
          </p>
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-40"
        >
          {refresh.isPending ? 'Fetching…' : 'Refresh from Spotify'}
        </button>
      </header>

      {refresh.error && (
        <p className="mb-3 text-sm text-red-400">{(refresh.error as Error).message}</p>
      )}

      {releases.isLoading && <p className="text-sm text-[var(--color-muted)]">Loading releases…</p>}

      {releases.data && releases.data.length === 0 && (
        <p className="text-sm text-[var(--color-muted)]">
          No new releases tracked yet. Click <strong>Refresh from Spotify</strong> to fetch.
        </p>
      )}

      {releases.data && releases.data.length > 0 && (
        <ul className="space-y-2">
          {releases.data.map((r) => <ReleaseRow key={r.id} release={r} />)}
        </ul>
      )}
    </div>
  )
}

function ReleaseRow({ release }: { release: ExternalRelease }) {
  const qc = useQueryClient()
  const update = useMutation({
    mutationFn: (body: { isDismissed?: boolean; isSavedForLater?: boolean }) =>
      artists.updateRelease(release.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['releases', release.artistProfileId] }),
  })

  return (
    <li className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      {release.artworkUrl ? (
        <img src={release.artworkUrl} alt="" className="h-12 w-12 shrink-0 rounded" />
      ) : (
        <div className="h-12 w-12 shrink-0 rounded bg-[var(--color-bg)]" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{release.title}</p>
        <p className="text-xs text-[var(--color-muted)]">
          {release.releaseType}
          {release.releaseDate && ` · ${release.releaseDate}`}
          {release.isAlreadyInLibrary && (
            <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">in library</span>
          )}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {release.url && bridgeAvailable() && (
          <button
            onClick={() => bridge.openExternal(release.url!)}
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
            title="Open on Spotify"
          >
            ↗
          </button>
        )}
        <button
          onClick={() => update.mutate({ isSavedForLater: true })}
          className="rounded border border-emerald-500/30 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
        >
          Want
        </button>
        <button
          onClick={() => update.mutate({ isDismissed: true })}
          className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
        >
          Dismiss
        </button>
      </div>
    </li>
  )
}
