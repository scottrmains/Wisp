import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { artists } from '../../api/artists'
import { discover } from '../../api/discover'
import type {
  ArtistSummary,
  CatalogSource,
  DiscoverArtistHit,
  DiscoverQuotaInfo,
  DiscoverVideoHit,
  ExternalRelease,
} from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { useUiPrefs } from '../../state/uiPrefs'
import { SoulseekPanel } from '../cratedigger/SoulseekPanel'
import { useWantedTracks } from '../wanted/useWantedTracks'
import { ArtistMatchModal } from './ArtistMatchModal'

/// Discover (Phase 22) — search-first UI. Replaces the long scroll list with
/// a search bar + two scopes:
///   - **My artists**: client-side filter over the existing library artist
///     list. Same per-artist detail flow (match / refresh / releases).
///   - **Anywhere**: Spotify (artists) + YouTube (videos), default-on, with
///     a YouTube quota meter so the user sees what they're spending.
///
/// Per-result Watch / Soulseek / Want lives on the result cards. Spotify
/// artist cards offer Follow → creates an ArtistProfile so the artist
/// enters the My-artists list with the existing refresh flow (Phase 8a).
export function DiscoverPage() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'my' | 'anywhere'>('my')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [matchTarget, setMatchTarget] = useState<{ artist: ArtistSummary; source: CatalogSource } | null>(null)

  const list = useQuery({
    queryKey: ['artists'],
    queryFn: () => artists.list(),
  })

  // My-artists filter: case-insensitive substring on name. ~1000 artists is
  // fine to filter client-side; promote to backend `?q=` if it ever bites.
  const filteredArtists = useMemo(() => {
    const all = list.data ?? []
    if (mode !== 'my' || !query.trim()) return all
    const needle = query.trim().toLowerCase()
    return all.filter((a) => a.name.toLowerCase().includes(needle))
  }, [list.data, query, mode])

  const selected = filteredArtists.find((a) => a.id === selectedId) ?? null

  // Switching the selected artist as the user types keeps the detail panel
  // showing something relevant. If the current selection drops out of the
  // filtered list, clear it.
  useEffect(() => {
    if (selectedId && !filteredArtists.some((a) => a.id === selectedId)) {
      setSelectedId(null)
    }
  }, [filteredArtists, selectedId])

  const flipToAnywhere = () => setMode('anywhere')

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-[var(--color-border)] px-6 py-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Discover</h1>
          <p className="text-xs text-[var(--color-muted)]">
            Search your library or anywhere. Watch on YouTube, find on Soulseek, mark Want.
          </p>
        </div>
        <SearchBar query={query} setQuery={setQuery} mode={mode} setMode={setMode} />
      </header>

      <div className="flex min-h-0 flex-1">
        {mode === 'my' ? (
          <>
            <ArtistList
              artists={filteredArtists}
              totalCount={list.data?.length ?? 0}
              loading={list.isLoading}
              query={query}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onSearchAnywhere={flipToAnywhere}
            />
            <div className="min-h-0 flex-1 overflow-y-auto border-l border-[var(--color-border)]">
              {selected ? (
                <ArtistDetail artist={selected} onMatch={(source) => setMatchTarget({ artist: selected, source })} />
              ) : (
                <p className="p-8 text-sm text-[var(--color-muted)]">
                  {query ? 'Pick an artist on the left to see what they\'ve released.' : 'Search above or pick an artist on the left.'}
                </p>
              )}
            </div>
          </>
        ) : (
          <AnywhereView query={query} />
        )}
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

function SearchBar({
  query,
  setQuery,
  mode,
  setMode,
}: {
  query: string
  setQuery: (q: string) => void
  mode: 'my' | 'anywhere'
  setMode: (m: 'my' | 'anywhere') => void
}) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="relative min-w-0 flex-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]">
          🔍
        </span>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={mode === 'my' ? 'Filter your library artists…' : 'Search Spotify + YouTube…'}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] py-2 pl-9 pr-3 text-sm focus:border-[var(--color-accent)] focus:outline-none"
        />
      </div>
      <div className="flex shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] p-0.5 text-xs">
        <button
          onClick={() => setMode('my')}
          className={[
            'rounded px-3 py-1.5 transition-colors',
            mode === 'my'
              ? 'bg-[var(--color-accent)] text-white'
              : 'text-[var(--color-muted)] hover:text-white',
          ].join(' ')}
        >
          My artists
        </button>
        <button
          onClick={() => setMode('anywhere')}
          className={[
            'rounded px-3 py-1.5 transition-colors',
            mode === 'anywhere'
              ? 'bg-[var(--color-accent)] text-white'
              : 'text-[var(--color-muted)] hover:text-white',
          ].join(' ')}
        >
          Anywhere
        </button>
      </div>
    </div>
  )
}

function ArtistList({
  artists: list,
  totalCount,
  loading,
  query,
  selectedId,
  onSelect,
  onSearchAnywhere,
}: {
  artists: ArtistSummary[]
  totalCount: number
  loading: boolean
  query: string
  selectedId: string | null
  onSelect: (id: string) => void
  onSearchAnywhere: () => void
}) {
  if (loading) {
    return (
      <aside className="w-[24rem] shrink-0 overflow-y-auto">
        <p className="p-4 text-sm text-[var(--color-muted)]">Loading artists…</p>
      </aside>
    )
  }
  if (totalCount === 0) {
    return (
      <aside className="w-[24rem] shrink-0 overflow-y-auto">
        <div className="space-y-2 p-6 text-sm text-[var(--color-muted)]">
          <p className="font-medium text-white">No artists in your library yet.</p>
          <p>Scan a folder first — Discover pulls from whatever artists are in your tagged tracks.</p>
        </div>
      </aside>
    )
  }
  // Filtered to nothing — leave the user a clear next step (flip to Anywhere).
  if (list.length === 0 && query.trim()) {
    return (
      <aside className="w-[24rem] shrink-0 overflow-y-auto">
        <div className="space-y-3 p-6 text-sm text-[var(--color-muted)]">
          <p className="font-medium text-white">No matches for "{query}" in your library.</p>
          <button
            onClick={onSearchAnywhere}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white"
          >
            Search anywhere instead →
          </button>
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

/// "Anywhere" search results — Spotify artists + YouTube videos, fetched
/// in parallel by the backend. Source toggles + quota meter live in the
/// header strip.
function AnywhereView({ query }: { query: string }) {
  const spotifyEnabled = useUiPrefs((s) => s.discoverSpotifyEnabled)
  const youtubeEnabled = useUiPrefs((s) => s.discoverYouTubeEnabled)
  const toggleSource = useUiPrefs((s) => s.toggleDiscoverSource)

  const sources = useMemo(() => {
    const parts: string[] = []
    if (spotifyEnabled) parts.push('spotify')
    if (youtubeEnabled) parts.push('youtube')
    return parts.join(',')
  }, [spotifyEnabled, youtubeEnabled])

  // Debounced query — typing one character per ~30ms shouldn't fire the
  // network call until the user pauses. 350ms is the standard "feels
  // responsive but not chatty" window.
  const [debounced, setDebounced] = useState(query)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350)
    return () => clearTimeout(t)
  }, [query])

  const enabled = debounced.trim().length >= 2 && sources.length > 0
  const search = useQuery({
    queryKey: ['discover-search', debounced.trim(), sources],
    queryFn: () => discover.search(debounced.trim(), sources),
    enabled,
    staleTime: 60_000,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-6 py-2 text-xs">
        <SourceToggle
          label="🟢 Spotify"
          enabled={spotifyEnabled}
          onToggle={() => toggleSource('spotify')}
        />
        <SourceToggle
          label="🎬 YouTube"
          enabled={youtubeEnabled}
          onToggle={() => toggleSource('youtube')}
        />
        {search.data?.youTubeQuota && (
          <QuotaMeter info={search.data.youTubeQuota} />
        )}
        {!enabled && debounced.trim().length < 2 && (
          <span className="ml-auto text-[var(--color-muted)]">
            Type at least 2 characters to search
          </span>
        )}
        {!enabled && sources.length === 0 && (
          <span className="ml-auto text-amber-300/80">
            Enable a source to search
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {search.isLoading && enabled && (
          <p className="text-sm text-[var(--color-muted)]">Searching…</p>
        )}
        {search.error && (
          <p className="text-sm text-red-400">{(search.error as Error).message}</p>
        )}
        {search.data && (
          <SearchResultsBlocks data={search.data} />
        )}
      </div>
    </div>
  )
}

function SourceToggle({
  label,
  enabled,
  onToggle,
}: {
  label: string
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      className={[
        'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
        enabled
          ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 text-white'
          : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-white',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function QuotaMeter({ info }: { info: DiscoverQuotaInfo }) {
  const remaining = info.dailyBudget - info.searchesToday
  const lowSoftCap = info.dailyBudget * 0.2 // 20% — start warning
  const tone = info.exhausted
    ? 'text-red-400'
    : remaining <= lowSoftCap
      ? 'text-amber-300'
      : 'text-[var(--color-muted)]'
  const reset = new Date(info.resetUtc)
  return (
    <span
      className={`ml-auto ${tone}`}
      title={`YouTube search.list quota. Resets ${reset.toLocaleString()}`}
    >
      🎬 {info.exhausted ? 'YouTube quota exhausted' : `${remaining}/${info.dailyBudget} searches left today`}
    </span>
  )
}

function SearchResultsBlocks({ data }: { data: import('../../api/types').DiscoverSearchResponse }) {
  const hasArtists = data.artists.length > 0
  const hasVideos = data.videos.length > 0

  if (!hasArtists && !hasVideos && data.errors.length === 0) {
    return <p className="text-sm text-[var(--color-muted)]">No results.</p>
  }

  return (
    <div className="space-y-6">
      {data.errors.includes('spotify_unconfigured') && (
        <ErrorBanner>Spotify isn't configured. Add credentials in Settings to enable artist search.</ErrorBanner>
      )}
      {data.errors.includes('youtube_unconfigured') && (
        <ErrorBanner>YouTube isn't configured. Add an API key in Settings to enable video search.</ErrorBanner>
      )}
      {data.errors.includes('spotify_failed') && (
        <ErrorBanner>Spotify search failed. Try again or check your credentials.</ErrorBanner>
      )}
      {data.errors.includes('youtube_failed') && (
        <ErrorBanner>YouTube search failed. Try again or check your credentials.</ErrorBanner>
      )}
      {data.errors.includes('youtube_quota_exhausted') && (
        <ErrorBanner tone="warn">
          YouTube quota exhausted for today. Spotify search continues; video results return after midnight UTC.
        </ErrorBanner>
      )}

      {hasArtists && (
        <section>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Artists · Spotify
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.artists.map((a) => (
              <ArtistResultCard key={a.externalId} hit={a} />
            ))}
          </div>
        </section>
      )}

      {hasVideos && (
        <section>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Videos · YouTube
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.videos.map((v) => (
              <VideoResultCard key={v.videoId} hit={v} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ErrorBanner({ children, tone = 'error' }: { children: React.ReactNode; tone?: 'error' | 'warn' }) {
  const cls = tone === 'error'
    ? 'border-red-500/30 bg-red-500/10 text-red-200'
    : 'border-amber-400/30 bg-amber-400/10 text-amber-200'
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${cls}`}>{children}</div>
  )
}

/// One Spotify artist hit — image + name + follower count + genres + Follow.
/// Wired in 22d (Follow creates an ArtistProfile + matches it). For now the
/// button is a placeholder so the layout is locked.
function ArtistResultCard({ hit }: { hit: DiscoverArtistHit }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      {hit.imageUrl ? (
        <img src={hit.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg)] text-lg text-[var(--color-muted)]">
          {hit.name[0]?.toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{hit.name}</p>
        <p className="truncate text-[11px] text-[var(--color-muted)]">
          {hit.followers !== null && `${hit.followers.toLocaleString()} followers`}
          {hit.genres.length > 0 && ` · ${hit.genres.slice(0, 3).join(', ')}`}
        </p>
      </div>
      <FollowButton hit={hit} />
    </div>
  )
}

/// Stub Follow button — the real thing (creates ArtistProfile + matches +
/// triggers an initial RefreshAsync) lands in 22d.
function FollowButton({ hit: _hit }: { hit: DiscoverArtistHit }) {
  return (
    <button
      disabled
      title="Follow lands in Phase 22d"
      className="shrink-0 rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] disabled:cursor-not-allowed"
    >
      + Follow
    </button>
  )
}

/// One YouTube video hit. Inline iframe expands on Watch; Soulseek expands
/// inline; Want POSTs a WantedTrack via the existing useWantedTracks hook.
function VideoResultCard({ hit }: { hit: DiscoverVideoHit }) {
  const [expandWatch, setExpandWatch] = useState(false)
  const [expandSlskd, setExpandSlskd] = useState(false)
  const wanted = useWantedTracks()

  // Crudely split the YouTube title into artist/title for the Want payload
  // and Soulseek search. Title parsing belongs in a real parser (see the
  // YouTubeTitleParser server-side); for now an em-dash / dash split gets
  // us 80% of cases. The Want row's freeform Notes can hold the original.
  const { artist, title } = parseYouTubeTitle(hit.title, hit.channelTitle)

  const onWant = () => {
    wanted.create.mutate({
      source: 'Discover',
      artist,
      title,
      sourceVideoId: hit.videoId,
      sourceUrl: hit.url,
      thumbnailUrl: hit.thumbnailUrl ?? undefined,
    })
  }

  // Reflect whether the same artist+title is already on the wishlist so the
  // button stops being clickable after the first add. The check is local
  // (just iterates the cached items) — cheap.
  const alreadyWanted = wanted.items.some(
    (w) => w.artist.toLowerCase() === artist.toLowerCase() && w.title.toLowerCase() === title.toLowerCase(),
  )

  return (
    <div className="flex flex-col rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex gap-3 p-3">
        {hit.thumbnailUrl ? (
          <img src={hit.thumbnailUrl} alt="" className="h-16 w-24 shrink-0 rounded object-cover" />
        ) : (
          <div className="h-16 w-24 shrink-0 rounded bg-[var(--color-bg)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium" title={hit.title}>{hit.title}</p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--color-muted)]" title={hit.channelTitle}>
            {hit.channelTitle}
            {hit.publishedAt && ` · ${new Date(hit.publishedAt).toLocaleDateString()}`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 border-t border-[var(--color-border)]/40 px-3 py-2">
        <button
          onClick={() => setExpandWatch((e) => !e)}
          className="rounded border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
          title="Watch on YouTube (embedded)"
        >
          {expandWatch ? '▾ Watch' : '▶ Watch'}
        </button>
        <button
          onClick={() => setExpandSlskd((e) => !e)}
          className="rounded border border-[var(--color-accent)]/40 px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
          title="Search Soulseek for this track"
        >
          {expandSlskd ? '▾ Soulseek' : '🎼 Soulseek'}
        </button>
        <button
          onClick={onWant}
          disabled={alreadyWanted || wanted.create.isPending}
          className={[
            'rounded border px-2 py-1 text-xs',
            alreadyWanted
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 cursor-default'
              : 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10',
          ].join(' ')}
          title={alreadyWanted ? 'Already on your Wanted list' : 'Add to Wanted'}
        >
          {alreadyWanted ? '✓ Wanted' : '❤ Want'}
        </button>
        {bridgeAvailable() && (
          <button
            onClick={() => bridge.openExternal(hit.url)}
            className="ml-auto rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
            title="Open on YouTube"
          >
            ↗
          </button>
        )}
      </div>
      {expandWatch && (
        <div className="border-t border-[var(--color-border)] p-3">
          <div className="aspect-video w-full overflow-hidden rounded bg-black">
            <iframe
              src={`https://www.youtube.com/embed/${hit.videoId}`}
              title={hit.title}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
      {expandSlskd && (
        <div className="border-t border-[var(--color-border)] px-3 pb-3">
          <SoulseekPanel artist={artist} title={title} />
        </div>
      )}
    </div>
  )
}

function parseYouTubeTitle(rawTitle: string, channelTitle: string): { artist: string; title: string } {
  // Quick heuristic — split on en-dash, em-dash, or first hyphen surrounded
  // by spaces. If the channel looks like an artist's Topic channel, prefer
  // that as the artist and use the full title as the track name.
  const topicMatch = channelTitle.match(/^(.+?)\s*-\s*Topic$/)
  if (topicMatch) return { artist: topicMatch[1], title: stripBrackets(rawTitle) }

  const sepIdx = rawTitle.search(/\s[-–—]\s/)
  if (sepIdx > 0) {
    return {
      artist: rawTitle.slice(0, sepIdx).trim(),
      title: stripBrackets(rawTitle.slice(sepIdx + 3).trim()),
    }
  }
  // Fallback: channel = artist, title = video title.
  return { artist: channelTitle, title: stripBrackets(rawTitle) }
}

function stripBrackets(s: string): string {
  return s.replace(/\[[^\]]*\]|\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
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

type ReleaseFilter = 'new' | 'saved' | 'dismissed' | 'library'

const FILTERS: { value: ReleaseFilter; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'saved', label: 'Wanted' },
  { value: 'library', label: 'In library' },
  { value: 'dismissed', label: 'Dismissed' },
]

function ArtistDetail({
  artist,
  onMatch,
}: {
  artist: ArtistSummary
  onMatch: (source: CatalogSource) => void
}) {
  const qc = useQueryClient()
  const anyMatched = artist.isMatchedSpotify || artist.isMatchedDiscogs || artist.isMatchedYouTube
  const [filter, setFilter] = useState<ReleaseFilter>('new')

  const releases = useQuery({
    queryKey: ['releases', artist.id, filter],
    queryFn: () => artists.releases(artist.id, filter),
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

      {anyMatched && (
        <div className="mt-4 flex items-center gap-1 border-b border-[var(--color-border)] pb-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={[
                'rounded-md px-3 py-1 text-xs',
                filter === f.value
                  ? 'bg-[var(--color-accent)]/20 text-white'
                  : 'text-[var(--color-muted)] hover:text-white',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {anyMatched && releases.isLoading && (
        <p className="mt-6 text-sm text-[var(--color-muted)]">Loading releases…</p>
      )}

      {anyMatched && releases.data && releases.data.length === 0 && filter !== 'new' && (
        <p className="mt-6 text-sm text-[var(--color-muted)]">
          {filter === 'saved' && 'No wanted tracks yet. Mark releases on the New tab as Want to collect them here.'}
          {filter === 'dismissed' && 'No dismissed tracks for this artist.'}
          {filter === 'library' && 'No fetched releases match anything in your local library yet.'}
        </p>
      )}

      {anyMatched && releases.data && releases.data.length === 0 && filter === 'new' && (
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
            <ReleaseRow key={r.id} release={r} artistName={artist.name} filter={filter} />
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

function ReleaseRow({
  release,
  artistName,
  filter,
}: {
  release: ExternalRelease
  artistName: string
  filter: ReleaseFilter
}) {
  const qc = useQueryClient()
  const [ytExpanded, setYtExpanded] = useState(false)
  const [slskdExpanded, setSlskdExpanded] = useState(false)
  const update = useMutation({
    mutationFn: (body: { isDismissed?: boolean; isSavedForLater?: boolean }) =>
      artists.updateRelease(release.id, body),
    // Invalidate every filter view of this artist's releases — moving a row between
    // status buckets needs to refresh both the source and destination tabs.
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
          {/* Soulseek search — same component Crate Digger uses, just fed the
              release's artist + title. Useful for tracking down vinyl-only / OOP
              material that the catalog sources only have a tracklist entry for. */}
          <button
            onClick={() => setSlskdExpanded((s) => !s)}
            className="rounded border border-[var(--color-accent)]/40 px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            title="Search Soulseek for this release"
          >
            {slskdExpanded ? '▾ Soulseek' : '🎼 Soulseek'}
          </button>
          {/* Action buttons swap based on which tab the row is rendered in.
              `library` tab is read-only — the row's already in the user's library,
              there's nothing to want/dismiss. */}
          {filter === 'new' && (
            <>
              <button
                onClick={() => update.mutate({ isSavedForLater: true })}
                className="rounded border border-emerald-500/30 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
                title="Move to Wanted tab"
              >
                Want
              </button>
              <button
                onClick={() => update.mutate({ isDismissed: true })}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
                title="Move to Dismissed tab"
              >
                Dismiss
              </button>
            </>
          )}
          {filter === 'saved' && (
            <button
              onClick={() => update.mutate({ isSavedForLater: false })}
              className="rounded border border-emerald-500/30 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
              title="Remove from Wanted (back to New)"
            >
              ✓ Wanted
            </button>
          )}
          {filter === 'dismissed' && (
            <button
              onClick={() => update.mutate({ isDismissed: false })}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
              title="Restore to New"
            >
              Restore
            </button>
          )}
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
      {slskdExpanded && (
        <div className="border-t border-[var(--color-border)] px-3 pb-3">
          <SoulseekPanel artist={artistName} title={release.title} />
        </div>
      )}
    </li>
  )
}
