import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  Disc3,
  ExternalLink,
  Heart,
  Play,
  Search as SearchIcon,
  Tv,
} from 'lucide-react'
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
import { SoulseekDialog } from '../soulseek/SoulseekDialog'
import { useWantedTracks } from '../wanted/useWantedTracks'
import { ArtistMatchModal } from './ArtistMatchModal'
import { youtubeLinks } from './youtubeLinks'
import { Button, IconButton } from '../../components/ui/Button'
import { SectionTabs } from '../../components/ui/SectionTabs'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { WorkspaceNavigation, NavigationToggle } from '../../components/ui/WorkspaceNavigation'

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
  const [matchTarget, setMatchTarget] = useState<{
    artist: ArtistSummary
    source: CatalogSource
  } | null>(null)

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
    <div className="feature-workspace discover-workspace">
      <header className="workspace-heading">
        <div className="min-w-0 flex-1">
          <h1>Discover</h1>
          <p>Find a track. Follow an artist. Keep the good stuff.</p>
        </div>
        {mode === 'my' && <NavigationToggle navigation="artists" label="artists" />}
      </header>
      <SearchBar query={query} setQuery={setQuery} mode={mode} setMode={setMode} />

      <div className="flex min-h-0 flex-1">
        {mode === 'my' ? (
          <>
            <WorkspaceNavigation navigation="artists" label="Artists">
              {list.isError ? (
                <StatusMessage tone="error">
                  Could not load artists: {list.error.message}.{' '}
                  <Button small onClick={() => void list.refetch()}>
                    Retry artists
                  </Button>
                </StatusMessage>
              ) : (
                <ArtistList
                  artists={filteredArtists}
                  totalCount={list.data?.length ?? 0}
                  loading={list.isLoading}
                  query={query}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onSearchAnywhere={flipToAnywhere}
                />
              )}
            </WorkspaceNavigation>
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              {selected ? (
                <ArtistDetail
                  key={selected.id}
                  artist={selected}
                  onMatch={(source) => setMatchTarget({ artist: selected, source })}
                />
              ) : (
                <p className="p-8 text-sm text-[var(--color-muted)]">
                  {query
                    ? "Pick an artist on the left to see what they've released."
                    : 'Search above or pick an artist on the left.'}
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
    <div>
      <SectionTabs
        label="Discover search scope"
        active={mode}
        onSelect={setMode}
        items={[
          { id: 'my', label: 'My artists' },
          { id: 'anywhere', label: 'Search anywhere' },
        ]}
      />
      <div className="workspace-toolbar">
        <label className="workspace-search">
          <SearchIcon size={16} />
          <span className="sr-only">Discover search</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Discover search"
            placeholder={
              mode === 'my'
                ? 'Filter your library artists…'
                : 'Artist, track title, or YouTube video link…'
            }
          />
        </label>
        <span className="text-xs text-[var(--color-muted)]">
          {mode === 'my'
            ? 'Filters library and followed artist names — not track titles'
            : 'Searches YouTube tracks and Spotify artists'}
        </span>
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
      <div className="min-h-0 overflow-y-auto">
        <p className="p-4 text-sm text-[var(--color-muted)]">Loading artists…</p>
      </div>
    )
  }
  if (totalCount === 0) {
    return (
      <div className="min-h-0 overflow-y-auto">
        <div className="space-y-2 p-6 text-sm text-[var(--color-muted)]">
          <p className="font-medium text-white">No artists in your library yet.</p>
          <p>
            Scan a folder first — Discover pulls from whatever artists are in your tagged tracks.
          </p>
        </div>
      </div>
    )
  }
  // Filtered to nothing — leave the user a clear next step (flip to Anywhere).
  if (list.length === 0 && query.trim()) {
    return (
      <div className="min-h-0 overflow-y-auto">
        <div className="space-y-3 p-6 text-sm text-[var(--color-muted)]">
          <p className="font-medium text-white">No matches for "{query}" in your library.</p>
          <Button
            small
            variant="primary"
            onClick={onSearchAnywhere}
            className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white"
          >
            Search anywhere instead →
          </Button>
        </div>
      </div>
    )
  }

  // Surface artists with new releases at the top so the screen leads with what's actionable.
  const sorted = [...list].sort((a, b) => {
    if (b.newReleaseCount !== a.newReleaseCount) return b.newReleaseCount - a.newReleaseCount
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ul>
        {sorted.map((a) => (
          <li key={a.id} className="workspace-nav-row" data-active={selectedId === a.id}>
            <button
              className="workspace-nav-choice"
              aria-current={selectedId === a.id ? 'page' : undefined}
              onClick={() => onSelect(a.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{a.name}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--color-muted)]">
                    <span>{a.trackCount} local</span>
                    {a.latestLocalYear !== null && <span>latest {a.latestLocalYear}</span>}
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
              <small>
                {[
                  a.isMatchedSpotify && 'Spotify',
                  a.isMatchedDiscogs && 'Discogs',
                  a.isMatchedYouTube && 'YouTube',
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No sources matched'}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/// "Anywhere" search results — Spotify artists + Tv videos, fetched
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
    retry: false,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-6 py-2 text-xs">
        <SourceToggle
          icon={<span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />}
          label="Spotify"
          enabled={spotifyEnabled}
          onToggle={() => toggleSource('spotify')}
        />
        <SourceToggle
          icon={<Tv size={12} strokeWidth={1.75} />}
          label="YouTube"
          enabled={youtubeEnabled}
          onToggle={() => toggleSource('youtube')}
        />
        {enabled && (
          <Button small onClick={() => void search.refetch()} disabled={search.isFetching}>
            {search.isFetching ? 'Searching…' : 'Retry search'}
          </Button>
        )}
        {search.data?.youTubeQuota && <QuotaMeter info={search.data.youTubeQuota} />}
        {!enabled && debounced.trim().length < 2 && (
          <span className="ml-auto text-[var(--color-muted)]">
            Type at least 2 characters to search
          </span>
        )}
        {!enabled && sources.length === 0 && (
          <span className="ml-auto text-amber-300/80">Enable a source to search</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {search.isFetching && enabled && (
          <p role="status" className="text-sm text-[var(--color-muted)]">
            Searching…
          </p>
        )}
        {search.error && (
          <p role="alert" className="text-sm text-red-400">
            {(search.error as Error).message}
          </p>
        )}
        {enabled && search.data && <SearchResultsBlocks data={search.data} />}
        {enabled && youtubeEnabled && !search.isFetching && (
          <p className="mt-4 text-xs text-[var(--color-muted)]">
            Missing a track? Paste its YouTube video link above to look it up directly, or{' '}
            <a
              href={youtubeLinks.search(debounced.trim())}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (bridgeAvailable()) {
                  e.preventDefault()
                  void bridge.openExternal(e.currentTarget.href)
                }
              }}
              className="underline hover:text-white"
            >
              search on YouTube
            </a>
            .
          </p>
        )}
      </div>
    </div>
  )
}

function SourceToggle({
  icon,
  label,
  enabled,
  onToggle,
}: {
  icon: React.ReactNode
  label: string
  enabled: boolean
  onToggle: () => void
}) {
  return (
    <Button
      small
      onClick={onToggle}
      aria-pressed={enabled}
      variant={enabled ? 'primary' : 'secondary'}
    >
      {icon}
      {label}
    </Button>
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
      className={`ml-auto inline-flex items-center gap-1.5 ${tone}`}
      title={`WISP's local Discover search-call budget, not Google's total API usage. Local reset: ${reset.toLocaleString()}. Direct video links don't consume this search budget.`}
    >
      <Tv size={12} strokeWidth={1.75} />
      {info.exhausted
        ? 'WISP search budget used'
        : `${remaining}/${info.dailyBudget} WISP search calls left`}
    </span>
  )
}

function SearchResultsBlocks({ data }: { data: import('../../api/types').DiscoverSearchResponse }) {
  const hasArtists = data.artists.length > 0
  const hasVideos = data.videos.length > 0

  if (!hasArtists && !hasVideos && data.errors.length === 0) {
    return (
      <p role="status" className="text-sm text-[var(--color-muted)]">
        No matching results returned. Try the artist and track title, or paste the YouTube video
        link.
      </p>
    )
  }

  return (
    <div className="discover-results">
      {data.errors.includes('spotify_unconfigured') && (
        <ErrorBanner>
          Spotify isn't configured. Add credentials in Settings to enable artist search.
        </ErrorBanner>
      )}
      {data.errors.includes('youtube_unconfigured') && (
        <ErrorBanner>
          YouTube isn't configured. Add an API key in Settings to enable video search.
        </ErrorBanner>
      )}
      {data.errors.includes('spotify_failed') && (
        <ErrorBanner>Spotify search failed. Try again or check your credentials.</ErrorBanner>
      )}
      {data.errors.includes('youtube_failed') && (
        <ErrorBanner>
          YouTube search failed. Retry the search or check your API key in Settings.
        </ErrorBanner>
      )}
      {data.errors.includes('youtube_quota_exhausted') && (
        <ErrorBanner tone="warn">
          YouTube search is unavailable because the local search budget or Google's API quota was
          reached. Spotify can still return artists. A video link can bypass the local search
          budget, but not Google's API limits.
        </ErrorBanner>
      )}
      {data.errors.includes('youtube_video_unavailable') && (
        <ErrorBanner tone="warn">
          YouTube did not return that video. It may be private, deleted or unavailable through the
          API.
        </ErrorBanner>
      )}

      {hasArtists && (
        <section className="discover-artists">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Artists · Spotify
          </h2>
          <div className="discover-artist-results">
            {data.artists.map((a) => (
              <ArtistResultCard key={a.externalId} hit={a} />
            ))}
          </div>
        </section>
      )}

      {hasVideos && (
        <section className="discover-videos">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
            Tracks & videos · YouTube
          </h2>
          <div className="workspace-results">
            {data.videos.map((v) => (
              <VideoResultCard key={v.videoId} hit={v} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function ErrorBanner({
  children,
  tone = 'error',
}: {
  children: React.ReactNode
  tone?: 'error' | 'warn'
}) {
  return <StatusMessage tone={tone === 'error' ? 'error' : undefined}>{children}</StatusMessage>
}

/// Spotify artist hit — vertical card to match the Tv-grid feel:
/// circular avatar on top, name below, followers + genres beneath, Follow
/// button at the bottom. Hover slightly raises the card so the grid feels
/// interactive at a glance.
function ArtistResultCard({ hit }: { hit: DiscoverArtistHit }) {
  return (
    <div className="discover-artist-result">
      {hit.imageUrl ? (
        <img src={hit.imageUrl} alt="" loading="lazy" className="h-12 w-12 shrink-0 object-cover" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center bg-[var(--color-bg)] text-lg text-[var(--color-muted)]">
          {hit.name[0]?.toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium" title={hit.name}>
          {hit.name}
        </p>
        <p className="line-clamp-2 text-[11px] text-[var(--color-muted)]">
          {hit.followers !== null && `${hit.followers.toLocaleString()} followers`}
          {hit.followers !== null && hit.genres.length > 0 && ' · '}
          {hit.genres.length > 0 && hit.genres.slice(0, 2).join(', ')}
        </p>
      </div>
      <FollowButton hit={hit} />
    </div>
  )
}

/// Follow button — POSTs to /api/discover/follow which creates (or
/// reuses) an ArtistProfile, attaches the Spotify ID, and runs an initial
/// refresh. After a successful follow, the artist appears in the My
/// artists list and the button flips to "✓ Following".
function FollowButton({ hit }: { hit: DiscoverArtistHit }) {
  const qc = useQueryClient()
  // Look up whether an ArtistProfile already exists for this Spotify ID
  // so the button reflects the actual state (e.g. the user already
  // follows this artist via the library scan).
  const artistList = useQuery({
    queryKey: ['artists'],
    queryFn: () => artists.list(),
  })
  const alreadyFollowing = (artistList.data ?? []).some(
    (a) => a.isMatchedSpotify && a.name.toLowerCase() === hit.name.toLowerCase(),
  )

  const follow = useMutation({
    mutationFn: () =>
      discover.follow({
        name: hit.name,
        spotifyArtistId: hit.externalId,
        imageUrl: hit.imageUrl ?? undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artists'] })
    },
  })

  if (alreadyFollowing || follow.isSuccess) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300"
        title="Already in your library — see them on the My artists tab"
      >
        <Check size={12} strokeWidth={2} /> Following
      </span>
    )
  }

  return (
    <div>
      <Button
        small
        onClick={() => follow.mutate()}
        disabled={follow.isPending}
        className="shrink-0 rounded-md border border-[var(--color-accent)]/40 px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10 disabled:opacity-40"
        title="Add this artist to your library and watch for new releases"
      >
        {follow.isPending ? 'Following…' : '+ Follow'}
      </Button>
      {follow.error && (
        <StatusMessage tone="error">
          Could not follow: {follow.error.message}. Try Follow again.
        </StatusMessage>
      )}
    </div>
  )
}

/// One Tv video hit. Inline iframe expands on Watch; Soulseek expands
/// inline; Want POSTs a WantedTrack via the existing useWantedTracks hook.
function VideoResultCard({ hit }: { hit: DiscoverVideoHit }) {
  const [expandWatch, setExpandWatch] = useState(false)
  const [expandSlskd, setExpandSlskd] = useState(false)
  const wanted = useWantedTracks()

  // Crudely split the Tv title into artist/title for the Want payload
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
    (w) =>
      w.artist.toLowerCase() === artist.toLowerCase() &&
      w.title.toLowerCase() === title.toLowerCase(),
  )

  return (
    <article className="discover-video-result" aria-label={hit.title}>
      <div className="discover-video-thumbnail">
        {hit.thumbnailUrl ? (
          <img
            src={hit.thumbnailUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[var(--color-muted)]">
            <Tv size={28} strokeWidth={1.25} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex flex-col gap-1">
        <p className="line-clamp-2 text-sm font-medium leading-snug" title={hit.title}>
          {hit.title}
        </p>
        <p className="truncate text-[11px] text-[var(--color-muted)]" title={hit.channelTitle}>
          {hit.channelTitle}
          {hit.publishedAt && ` · ${new Date(hit.publishedAt).toLocaleDateString()}`}
        </p>
      </div>
      <div className="discover-video-actions">
        <Button
          small
          aria-expanded={expandWatch}
          onClick={() => setExpandWatch((e) => !e)}
          className="inline-flex items-center gap-1 rounded border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
          title="Watch on YouTube (embedded)"
        >
          {expandWatch ? (
            <ChevronDown size={11} strokeWidth={1.75} />
          ) : (
            <Play size={10} fill="currentColor" />
          )}{' '}
          Watch
        </Button>
        <Button
          small
          aria-expanded={expandSlskd}
          onClick={() => setExpandSlskd((e) => !e)}
          className="inline-flex items-center gap-1 rounded border border-[var(--color-accent)]/40 px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
          title="Search Soulseek for this track"
        >
          {expandSlskd ? (
            <ChevronDown size={11} strokeWidth={1.75} />
          ) : (
            <Disc3 size={11} strokeWidth={1.75} />
          )}{' '}
          Soulseek
        </Button>
        <Button
          small
          onClick={onWant}
          disabled={alreadyWanted || wanted.create.isPending}
          className={[
            'inline-flex items-center gap-1 rounded border px-2 py-1 text-xs',
            alreadyWanted
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 cursor-default'
              : 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10',
          ].join(' ')}
          title={alreadyWanted ? 'Already on your Wanted list' : 'Add to Wanted'}
        >
          {alreadyWanted ? (
            <>
              <Check size={11} strokeWidth={2} /> Wanted
            </>
          ) : (
            <>
              <Heart size={11} strokeWidth={1.75} /> Want
            </>
          )}
        </Button>
        {bridgeAvailable() && (
          <IconButton
            small
            variant="quiet"
            label="Open on YouTube"
            onClick={() => bridge.openExternal(hit.url)}
            className="ml-auto rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
            title="Open on YouTube"
          >
            <ExternalLink size={12} strokeWidth={1.75} />
          </IconButton>
        )}
      </div>
      {wanted.create.error && (
        <StatusMessage tone="error">
          Could not add to Wanted: {wanted.create.error.message}. Try Want again.
        </StatusMessage>
      )}
      {expandWatch && (
        <div className="discover-video-expanded">
          <div className="aspect-video w-full overflow-hidden rounded bg-black">
            <iframe
              src={youtubeLinks.embed(hit.videoId)}
              title={hit.title}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
      {expandSlskd && (
        <SoulseekDialog
          initialArtist={artist}
          initialTitle={title}
          onClose={() => setExpandSlskd(false)}
        />
      )}
    </article>
  )
}

function parseYouTubeTitle(
  rawTitle: string,
  channelTitle: string,
): { artist: string; title: string } {
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
  return s
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
            {artist.lastCheckedAt &&
              ` · last checked ${new Date(artist.lastCheckedAt).toLocaleDateString()}`}
          </p>
        </div>
        {anyMatched && (
          <Button
            small
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="shrink-0 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-40"
          >
            {refresh.isPending ? 'Fetching…' : 'Refresh from sources'}
          </Button>
        )}
      </header>

      <SourceMatchRow artist={artist} onMatch={onMatch} />

      {refresh.error && (
        <StatusMessage tone="error">
          Could not refresh releases: {refresh.error.message}. Try Refresh from sources again.
        </StatusMessage>
      )}

      {!anyMatched && (
        <div className="mt-6 space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted)]">
          <p className="text-white">No source matched yet.</p>
          <p>
            Pick a source above to identify this artist. Different sources cover different ground:
          </p>
          <ul className="ml-4 list-disc text-[12px]">
            <li>
              <strong className="text-white">Spotify</strong> — broad streaming catalogue, fast for
              current/active artists
            </li>
            <li>
              <strong className="text-white">Discogs</strong> — vinyl + underground, best for old
              white-label material
            </li>
            <li>
              <strong className="text-white">YouTube</strong> — enriches matched releases with an
              inline audition player
            </li>
          </ul>
        </div>
      )}

      {anyMatched && (
        <div className="mt-4">
          <SectionTabs
            label="Release status"
            items={FILTERS.map((f) => ({ id: f.value, label: f.label }))}
            active={filter}
            onSelect={setFilter}
          />
        </div>
      )}

      {anyMatched && releases.isLoading && (
        <p className="mt-6 text-sm text-[var(--color-muted)]">Loading releases…</p>
      )}
      {releases.error && (
        <StatusMessage tone="error">
          Could not load releases: {releases.error.message}.{' '}
          <Button small onClick={() => void releases.refetch()}>
            Retry releases
          </Button>
        </StatusMessage>
      )}

      {anyMatched && releases.data && releases.data.length === 0 && filter !== 'new' && (
        <p className="mt-6 text-sm text-[var(--color-muted)]">
          {filter === 'saved' &&
            'No wanted tracks yet. Mark releases on the New tab as Want to collect them here.'}
          {filter === 'dismissed' && 'No dismissed tracks for this artist.'}
          {filter === 'library' && 'No fetched releases match anything in your local library yet.'}
        </p>
      )}

      {anyMatched && releases.data && releases.data.length === 0 && filter === 'new' && (
        <div className="mt-6 space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted)]">
          <p className="text-white">
            No new releases since {artist.latestLocalYear ?? 'your latest local track'}.
          </p>
          <p>
            Click <strong className="text-white">Refresh from sources</strong> to re-poll. To
            broaden the search, match additional sources (you currently have:
            {[
              artist.isMatchedSpotify && ' Spotify',
              artist.isMatchedDiscogs && ' Discogs',
              artist.isMatchedYouTube && ' YouTube',
            ]
              .filter(Boolean)
              .join(', ')}
            ).
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
    <div className="flex flex-wrap items-center gap-2">
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
  const ring =
    colour === 'emerald'
      ? 'border-emerald-500/40 bg-emerald-500/10'
      : colour === 'orange'
        ? 'border-orange-400/40 bg-orange-400/10'
        : 'border-red-500/40 bg-red-500/10'

  return (
    <Button
      small
      onClick={onMatch}
      className={[
        'rounded-md border px-3 py-2 text-left text-sm transition-colors',
        matched ? ring : 'border-[var(--color-border)] hover:bg-white/5',
      ].join(' ')}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        <span
          className={`inline-flex items-center gap-1 text-xs ${matched ? 'text-white' : 'text-[var(--color-muted)]'}`}
        >
          {matched ? (
            <>
              <Check size={11} strokeWidth={2} /> matched
            </>
          ) : (
            <>
              match <ChevronDown size={11} strokeWidth={1.75} className="-rotate-90" />
            </>
          )}
        </span>
      </div>
    </Button>
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

  const sourceColour =
    release.source === 'Spotify'
      ? 'bg-emerald-500/20 text-emerald-300'
      : release.source === 'Discogs'
        ? 'bg-orange-400/20 text-orange-300'
        : 'bg-white/10 text-[var(--color-muted)]'

  const searchYouTube = () => {
    const q = `${artistName} ${release.title}`
    if (bridgeAvailable()) void bridge.openExternal(youtubeLinks.search(q))
  }

  return (
    <li className="workspace-result-row">
      <div className="discover-release-row">
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
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                in library
              </span>
            )}
          </p>
        </div>
        <div className="discover-release-actions">
          {release.youTubeVideoId ? (
            <Button
              small
              aria-expanded={ytExpanded}
              onClick={() => setYtExpanded((e) => !e)}
              className="inline-flex items-center gap-1 rounded border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
              title="Watch on YouTube"
            >
              {ytExpanded ? (
                <ChevronDown size={11} strokeWidth={1.75} />
              ) : (
                <Play size={10} fill="currentColor" />
              )}{' '}
              Watch
            </Button>
          ) : (
            bridgeAvailable() && (
              <Button
                small
                onClick={searchYouTube}
                className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
                title="Search YouTube for this release"
              >
                <SearchIcon size={11} strokeWidth={1.75} /> YouTube
              </Button>
            )
          )}
          {release.url && bridgeAvailable() && (
            <IconButton
              small
              label={`Open on ${release.source}`}
              onClick={() => bridge.openExternal(release.url!)}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
              title={`Open on ${release.source}`}
            >
              <ExternalLink size={12} strokeWidth={1.75} />
            </IconButton>
          )}
          {/* Soulseek search — same component Crate Digger uses, just fed the
              release's artist + title. Useful for tracking down vinyl-only / OOP
              material that the catalog sources only have a tracklist entry for. */}
          <Button
            small
            aria-expanded={slskdExpanded}
            onClick={() => setSlskdExpanded((s) => !s)}
            className="inline-flex items-center gap-1 rounded border border-[var(--color-accent)]/40 px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
            title="Search Soulseek for this release"
          >
            {slskdExpanded ? (
              <ChevronDown size={11} strokeWidth={1.75} />
            ) : (
              <Disc3 size={11} strokeWidth={1.75} />
            )}{' '}
            Soulseek
          </Button>
          {/* Action buttons swap based on which tab the row is rendered in.
              `library` tab is read-only — the row's already in the user's library,
              there's nothing to want/dismiss. */}
          {filter === 'new' && (
            <>
              <Button
                small
                disabled={update.isPending}
                onClick={() => update.mutate({ isSavedForLater: true })}
                className="rounded border border-emerald-500/30 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
                title="Move to Wanted tab"
              >
                Want
              </Button>
              <Button
                small
                disabled={update.isPending}
                onClick={() => update.mutate({ isDismissed: true })}
                className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
                title="Move to Dismissed tab"
              >
                Dismiss
              </Button>
            </>
          )}
          {filter === 'saved' && (
            <Button
              small
              disabled={update.isPending}
              onClick={() => update.mutate({ isSavedForLater: false })}
              className="inline-flex items-center gap-1 rounded border border-emerald-500/30 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10"
              title="Remove from Wanted (back to New)"
            >
              <Check size={11} strokeWidth={2} /> Wanted
            </Button>
          )}
          {filter === 'dismissed' && (
            <Button
              small
              disabled={update.isPending}
              onClick={() => update.mutate({ isDismissed: false })}
              className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
              title="Restore to New"
            >
              Restore
            </Button>
          )}
        </div>
      </div>
      {update.error && (
        <StatusMessage tone="error">
          Could not save release status: {update.error.message}. Try the action again.
        </StatusMessage>
      )}
      {ytExpanded && release.youTubeVideoId && (
        <div className="border-t border-[var(--color-border)] p-3">
          <div className="aspect-video w-full overflow-hidden rounded bg-black">
            <iframe
              src={youtubeLinks.embed(release.youTubeVideoId)}
              title={`${release.title} — YouTube preview`}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
      )}
      {slskdExpanded && (
        <SoulseekDialog
          initialArtist={artistName}
          initialTitle={release.title}
          onClose={() => setSlskdExpanded(false)}
        />
      )}
    </li>
  )
}
