import { useState } from 'react'
import { Check, Disc3, ExternalLink, X, Search, Heart, Clock } from 'lucide-react'
import { Button, IconButton } from '../../components/ui/Button'
import { SectionTabs } from '../../components/ui/SectionTabs'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { useCurrentPage } from '../../state/currentPage'
import type { WantedTrack } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { confirmDialog } from '../../components/dialog'
import { SoulseekDialog } from '../soulseek/SoulseekDialog'
import { useWantedTracks } from './useWantedTracks'

/// Single timeline-sorted page for everything the user has marked Want from
/// anywhere in the app. Source badges differentiate where each row came
/// from. Found-in-library items stick around (with a ✓ in library chip)
/// rather than auto-disappearing — confirms the success.
export function WantedPage() {
  const { items, loading, error, retry, remove } = useWantedTracks()
  const [status, setStatus] = useState<'all' | 'waiting' | 'found'>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<'newest' | 'oldest' | 'artist'>('newest')
  const [slskdFor, setSlskdFor] = useState<string | null>(null) // wanted track id

  const visible = items
    .filter(
      (w) =>
        (status === 'all' || (status === 'found') === !!w.matchedLocalTrackId) &&
        `${w.artist} ${w.title}`.toLowerCase().includes(search.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'artist'
        ? a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)
        : (sort === 'newest' ? -1 : 1) * (Date.parse(a.addedAt) - Date.parse(b.addedAt)),
    )
  const foundCount = items.filter((w) => !!w.matchedLocalTrackId).length

  const handleRemove = async (w: WantedTrack) => {
    const ok = await confirmDialog({
      title: 'Remove from Wanted?',
      message: `"${w.artist} — ${w.title}" will be removed from your wishlist. This won't delete the local track if you already have one.`,
      danger: true,
      confirmLabel: 'Remove',
    })
    if (!ok) return
    remove.mutate(w.id)
  }

  return (
    <div className="feature-workspace wanted-workspace">
      <header className="workspace-heading">
        <div className="min-w-0 flex-1">
          <h1>Wanted</h1>
          <p>
            {items.length - foundCount} waiting · {foundCount} found in your library
          </p>
        </div>
        <Button onClick={() => useCurrentPage.getState().setPage('discover')}>
          <Search /> Discover music
        </Button>
      </header>
      <SectionTabs
        label="Wanted status"
        active={status}
        onSelect={setStatus}
        items={[
          { id: 'all', label: 'All' },
          { id: 'waiting', label: 'Waiting', icon: <Clock /> },
          { id: 'found', label: 'Found', icon: <Check /> },
        ]}
      />
      <div className="workspace-toolbar">
        <label className="workspace-search">
          <Search />
          <span className="sr-only">Search wanted tracks</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artist or track…"
          />
        </label>
        <label className="workspace-select">
          Sort by
          <select
            aria-label="Sort wanted tracks"
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
          >
            <option value="newest">Newest added</option>
            <option value="oldest">Oldest added</option>
            <option value="artist">Artist A–Z</option>
          </select>
        </label>
      </div>
      {error && (
        <StatusMessage tone="error">
          Could not load Wanted: {error.message}.{' '}
          <Button small onClick={() => void retry()}>
            Retry wanted tracks
          </Button>
        </StatusMessage>
      )}
      {remove.error && (
        <StatusMessage tone="error">
          Could not remove the track: {remove.error.message}. Try Remove again.
        </StatusMessage>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {loading && <p className="text-sm text-[var(--color-muted)]">Loading wanted tracks…</p>}
        {!loading && !error && items.length === 0 && (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-muted)]">
            <Heart className="mb-3" />
            <p>Nothing wanted yet.</p>
            <p className="mt-1">
              Mark <strong>Want</strong> on any result in <strong>Discover</strong> or{' '}
              <strong>Crate Digger</strong> and it'll collect here. The next time a library scan
              finds the track, it'll auto-flag as in-library.
            </p>
          </div>
        )}
        {!loading && visible.length === 0 && items.length > 0 && (
          <p className="workspace-empty">
            No tracks match this search and status. Choose All or clear your search.
          </p>
        )}
        <ul aria-label="Wanted tracks" className="workspace-results">
          {visible.map((w) => (
            <li key={w.id} className="workspace-result-row">
              <div className="flex items-center gap-3 p-3">
                {w.thumbnailUrl ? (
                  <img
                    src={w.thumbnailUrl}
                    alt=""
                    className="h-12 w-16 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-16 shrink-0 items-center justify-center rounded bg-[var(--color-bg)] text-xs text-[var(--color-muted)]">
                    {w.source[0]}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {w.artist} <span className="text-[var(--color-muted)]">—</span> {w.title}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--color-muted)]">
                    <SourceBadge source={w.source} />
                    <span>· added {new Date(w.addedAt).toLocaleDateString()}</span>
                    {w.matchedLocalTrackId && (
                      <span className="inline-flex items-center gap-1 text-[var(--ui-success)]">
                        <Check size={12} strokeWidth={2} /> Found in library
                      </span>
                    )}
                    {!w.matchedLocalTrackId && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} /> Waiting
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {w.sourceUrl && bridgeAvailable() && (
                    <IconButton
                      small
                      variant="quiet"
                      onClick={() => bridge.openExternal(w.sourceUrl!)}
                      className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
                      label="Open source"
                    >
                      <ExternalLink size={12} strokeWidth={1.75} />
                    </IconButton>
                  )}
                  <Button
                    small
                    onClick={() => setSlskdFor(w.id)}
                    className="inline-flex items-center gap-1 rounded border border-[var(--color-accent)]/40 px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
                    tooltip="Search Soulseek"
                  >
                    <Disc3 size={11} strokeWidth={1.75} /> Soulseek
                  </Button>
                  <IconButton
                    small
                    variant="quiet"
                    onClick={() => handleRemove(w)}
                    className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-red-300"
                    label="Remove from Wanted"
                    disabled={remove.isPending}
                  >
                    <X size={12} strokeWidth={1.75} />
                  </IconButton>
                </div>
              </div>
              {slskdFor === w.id && (
                <SoulseekDialog
                  initialArtist={w.artist}
                  initialTitle={w.title}
                  onClose={() => setSlskdFor(null)}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SourceBadge({ source }: { source: WantedTrack['source'] }) {
  const cls =
    source === 'Discover'
      ? 'bg-purple-500/20 text-purple-200'
      : source === 'CrateDigger'
        ? 'bg-amber-500/20 text-amber-200'
        : 'bg-white/10 text-[var(--color-muted)]'
  const label = source === 'CrateDigger' ? 'Crate Digger' : source
  return <span className={`rounded px-1.5 py-0.5 text-[10px] ${cls}`}>{label}</span>
}
