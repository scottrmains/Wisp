import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { artists } from '../../api/artists'
import type { ArtistSummary, CatalogSource, ExternalRelease } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { ArtistMatchModal } from './ArtistMatchModal'

interface Props {
  onClose: () => void
}

export function RediscoverScreen({ onClose }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [matchTarget, setMatchTarget] = useState<{ artist: ArtistSummary; source: CatalogSource } | null>(null)

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
            See what your favourite artists released since you last checked. Match across Spotify, Discogs, and YouTube.
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
        />
        <div className="min-h-0 flex-1 overflow-y-auto border-l border-[var(--color-border)]">
          {selected ? (
            <ArtistDetail artist={selected} onMatch={(source) => setMatchTarget({ artist: selected, source })} />
          ) : (
            <p className="p-8 text-sm text-[var(--color-muted)]">
              Pick an artist on the left to see what they've released.
            </p>
          )}
        </div>
      </div>

      {matchTarget && (
        <ArtistMatchModal
          artist={matchTarget.artist}
          source={matchTarget.source}
          onClose={() => setMatchTarget(null)}
          onMatched={() => setMatchTarget(null)}
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
}: {
  artists: ArtistSummary[]
  loading: boolean
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  if (loading) {
    return (
      <aside className="w-[24rem] shrink-0 overflow-y-auto">
        <p className="p-4 text-sm text-[var(--color-muted)]">Loading artists…</p>
      </aside>
    )
  }
  if (list.length === 0) {
    return (
      <aside className="w-[24rem] shrink-0 overflow-y-auto">
        <div className="space-y-2 p-6 text-sm text-[var(--color-muted)]">
          <p className="font-medium text-white">No artists in your library yet.</p>
          <p>Scan a folder first — Rediscover pulls from whatever artists are in your tagged tracks.</p>
        </div>
      </aside>
    )
  }

  // Surface artists with new releases at the top so the screen leads with what's actionable.
  const sorted = [...list].sort((a, b) => {
    if (b.newReleaseCount !== a.newReleaseCount) return b.newReleaseCount - a.newReleaseCount
    return a.name.localeCompare(b.name)
  })

  return (
    <aside className="w-[24rem] shrink-0 overflow-y-auto">
      <ul>
        {sorted.map((a) => (
          <li
            key={a.id}
            className={[
              'cursor-pointer border-b border-[var(--color-border)]/40 px-4 py-3 text-sm hover:bg-white/5',
              selectedId === a.id ? 'bg-[var(--color-accent)]/10' : '',
            ].join(' ')}
            onClick={() => onSelect(a.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{a.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-muted)]">
                  <span>{a.trackCount} local</span>
                  {a.latestLocalYear !== null && (
                    <span>latest {a.latestLocalYear}</span>
                  )}
                  {a.newReleaseCount > 0 && (
                    <span className="font-medium text-[var(--color-accent)]">
                      {a.newReleaseCount} new
                    </span>
                  )}
                </div>
              </div>
              {a.newReleaseCount > 0 && (
                <span className="shrink-0 rounded-md bg-[var(--color-accent)] px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                  +{a.newReleaseCount}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <SourceChip name="Spotify" matched={a.isMatchedSpotify} tone="emerald" />
              <SourceChip name="Discogs" matched={a.isMatchedDiscogs} tone="orange" />
              <SourceChip name="YouTube" matched={a.isMatchedYouTube} tone="red" />
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function SourceChip({
  name,
  matched,
  tone,
}: {
  name: string
  matched: boolean
  tone: 'emerald' | 'orange' | 'red'
}) {
  const matchedCls = tone === 'emerald'
    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
    : tone === 'orange'
      ? 'border-orange-400/40 bg-orange-400/10 text-orange-200'
      : 'border-red-500/40 bg-red-500/10 text-red-200'
  return (
    <span
      className={[
        'rounded border px-1.5 py-0.5 text-[10px]',
        matched ? matchedCls : 'border-[var(--color-border)] bg-transparent text-[var(--color-muted)]/60',
      ].join(' ')}
      title={`${name} ${matched ? 'matched' : 'not matched'}`}
    >
      {name}
      {!matched && ' —'}
    </span>
  )
}

function ArtistDetail({
  artist,
  onMatch,
}: {
  artist: ArtistSummary
  onMatch: (source: CatalogSource) => void
}) {
  const qc = useQueryClient()
  const anyMatched = artist.isMatchedSpotify || artist.isMatchedDiscogs || artist.isMatchedYouTube

  const releases = useQuery({
    queryKey: ['releases', artist.id, 'new'],
    queryFn: () => artists.releases(artist.id, 'new'),
    enabled: anyMatched,
  })

  const refresh = useMutation({
    mutationFn: () => artists.refresh(artist.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['releases', artist.id] })
      qc.invalidateQueries({ queryKey: ['artists'] })
    },
  })

  return (
    <div className="p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold">{artist.name}</h2>
          <p className="text-sm text-[var(--color-muted)]">
            {artist.trackCount} local
            {artist.latestLocalYear !== null && ` · latest ${artist.latestLocalYear}`}
            {artist.lastCheckedAt && ` · last checked ${new Date(artist.lastCheckedAt).toLocaleDateString()}`}
          </p>
        </div>
        {anyMatched && (
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="shrink-0 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-40"
          >
            {refresh.isPending ? 'Fetching…' : 'Refresh from sources'}
          </button>
        )}
      </header>

      <SourceMatchRow artist={artist} onMatch={onMatch} />

      {refresh.error && (
        <p className="mt-3 text-sm text-red-400">{(refresh.error as Error).message}</p>
      )}

      {!anyMatched && (
        <div className="mt-6 space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted)]">
          <p className="text-white">No source matched yet.</p>
          <p>Pick a source above to identify this artist. Different sources cover different ground:</p>
          <ul className="ml-4 list-disc text-[12px]">
            <li><strong className="text-white">Spotify</strong> — broad streaming catalogue, fast for current/active artists</li>
            <li><strong className="text-white">Discogs</strong> — vinyl + underground, best for old white-label material</li>
            <li><strong className="text-white">YouTube</strong> — enriches matched releases with an inline audition player</li>
          </ul>
        </div>
      )}

      {anyMatched && releases.isLoading && (
        <p className="mt-6 text-sm text-[var(--color-muted)]">Loading releases…</p>
      )}

      {anyMatched && releases.data && releases.data.length === 0 && (
        <div className="mt-6 space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted)]">
          <p className="text-white">No new releases since {artist.latestLocalYear ?? 'your latest local track'}.</p>
          <p>
            Click <strong className="text-white">Refresh from sources</strong> to re-poll. To broaden the search,
            match additional sources (you currently have:
            {[
              artist.isMatchedSpotify && ' Spotify',
              artist.isMatchedDiscogs && ' Discogs',
              artist.isMatchedYouTube && ' YouTube',
            ].filter(Boolean).join(', ')}).
          </p>
        </div>
      )}

      {releases.data && releases.data.length > 0 && (
        <ul className="mt-4 space-y-2">
          {releases.data.map((r) => (
            <ReleaseRow key={r.id} release={r} artistName={artist.name} />
          ))}
        </ul>
      )}
    </div>
  )
}

function SourceMatchRow({
  artist,
  onMatch,
}: {
  artist: ArtistSummary
  onMatch: (source: CatalogSource) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <SourceMatchTile
        label="Spotify"
        matched={artist.isMatchedSpotify}
        colour="emerald"
        onMatch={() => onMatch('Spotify')}
      />
      <SourceMatchTile
        label="Discogs"
        matched={artist.isMatchedDiscogs}
        colour="orange"
        onMatch={() => onMatch('Discogs')}
      />
      <SourceMatchTile
        label="YouTube"
        matched={artist.isMatchedYouTube}
        colour="red"
        onMatch={() => onMatch('YouTube')}
      />
    </div>
  )
}

function SourceMatchTile({
  label,
  matched,
  colour,
  onMatch,
}: {
  label: string
  matched: boolean
  colour: 'emerald' | 'orange' | 'red'
  onMatch: () => void
}) {
  const ring = colour === 'emerald'
    ? 'border-emerald-500/40 bg-emerald-500/10'
    : colour === 'orange'
      ? 'border-orange-400/40 bg-orange-400/10'
      : 'border-red-500/40 bg-red-500/10'

  return (
    <button
      onClick={onMatch}
      className={[
        'rounded-md border px-3 py-2 text-left text-sm transition-colors',
        matched ? ring : 'border-[var(--color-border)] hover:bg-white/5',
      ].join(' ')}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span className={`text-xs ${matched ? 'text-white' : 'text-[var(--color-muted)]'}`}>
          {matched ? '✓ matched' : 'match →'}
        </span>
      </div>
      <p className="mt-0.5 text-[10px] text-[var(--color-muted)]">
        {label === 'Spotify' && 'broad streaming catalogue'}
        {label === 'Discogs' && 'vinyl + underground'}
        {label === 'YouTube' && 'inline audition'}
      </p>
    </button>
  )
}

function ReleaseRow({ release, artistName }: { release: ExternalRelease; artistName: string }) {
  const qc = useQueryClient()
  const [ytExpanded, setYtExpanded] = useState(false)
  const update = useMutation({
    mutationFn: (body: { isDismissed?: boolean; isSavedForLater?: boolean }) =>
      artists.updateRelease(release.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['releases', release.artistProfileId] }),
  })

  const sourceColour = release.source === 'Spotify'
    ? 'bg-emerald-500/20 text-emerald-300'
    : release.source === 'Discogs'
      ? 'bg-orange-400/20 text-orange-300'
      : 'bg-white/10 text-[var(--color-muted)]'

  const searchYouTube = () => {
    const q = encodeURIComponent(`${artistName} ${release.title}`)
    if (bridgeAvailable()) void bridge.openExternal(`https://www.youtube.com/results?search_query=${q}`)
  }

  return (
    <li className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-3 p-3">
        {release.artworkUrl ? (
          <img src={release.artworkUrl} alt="" className="h-12 w-12 shrink-0 rounded" />
        ) : (
          <div className="h-12 w-12 shrink-0 rounded bg-[var(--color-bg)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{release.title}</p>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-muted)]">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${sourceColour}`}>
              {release.source[0]}
            </span>
            <span>{release.releaseType}</span>
            {release.releaseDate && <span>· {release.releaseDate}</span>}
            {release.isAlreadyInLibrary && (
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">in library</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          {release.youTubeVideoId ? (
            <button
              onClick={() => setYtExpanded((e) => !e)}
              className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
              title="Audition on YouTube"
            >
              {ytExpanded ? '▾ YouTube' : '▶ YouTube'}
            </button>
          ) : (
            bridgeAvailable() && (
              <button
                onClick={searchYouTube}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
                title="Search YouTube for this release"
              >
                🔍 YT
              </button>
            )
          )}
          {release.url && bridgeAvailable() && (
            <button
              onClick={() => bridge.openExternal(release.url!)}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
              title={`Open on ${release.source}`}
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
      </div>
      {ytExpanded && release.youTubeVideoId && (
        <div className="border-t border-[var(--color-border)] p-3">
          <div className="aspect-video w-full overflow-hidden rounded bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${release.youTubeVideoId}`}
              title={`${release.title} — YouTube audition`}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
    </li>
  )
}
