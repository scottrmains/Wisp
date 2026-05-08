import type { DiscoveredTrack, DiscoveryStatus } from '../../api/types'

interface Props {
  tracks: DiscoveredTrack[]
  loading: boolean
  onSelect: (t: DiscoveredTrack) => void
}

const STATUS_PILL: Record<DiscoveryStatus, { label: string; tone: string }> = {
  New: { label: 'new', tone: 'bg-white/10 text-[var(--color-muted)]' },
  Want: { label: 'want', tone: 'bg-emerald-500/20 text-emerald-300' },
  AlreadyHave: { label: 'have', tone: 'bg-blue-500/20 text-blue-300' },
  Ignore: { label: 'ignored', tone: 'bg-white/5 text-[var(--color-muted)]' },
  NoMatch: { label: 'no match', tone: 'bg-red-500/20 text-red-300' },
  VinylOnly: { label: 'vinyl only', tone: 'bg-amber-500/20 text-amber-300' },
  DigitalAvailable: { label: 'digital ✓', tone: 'bg-emerald-500/30 text-emerald-200' },
  PossibleMatch: { label: 'possible', tone: 'bg-amber-400/20 text-amber-300' },
}

export function DiscoveredTrackList({ tracks, loading, onSelect }: Props) {
  if (loading) return <p className="p-6 text-sm text-[var(--color-muted)]">Loading tracks…</p>
  if (tracks.length === 0) {
    return (
      <p className="p-6 text-sm text-[var(--color-muted)]">
        No tracks match the current filter. Try the <strong>All</strong> tab.
      </p>
    )
  }

  return (
    <ul>
      {tracks.map((t) => (
        <li
          key={t.id}
          onClick={() => onSelect(t)}
          className="grid cursor-pointer grid-cols-[5rem_1fr_auto] items-center gap-3 border-b border-[var(--color-border)]/40 px-4 py-2.5 text-sm hover:bg-white/5"
        >
          {t.thumbnailUrl ? (
            <img src={t.thumbnailUrl} alt="" className="h-12 w-20 rounded object-cover" loading="lazy" />
          ) : (
            <div className="h-12 w-20 rounded bg-[var(--color-surface)]" />
          )}
          <div className="min-w-0">
            {t.parsedArtist && t.parsedTitle ? (
              <p className="truncate text-sm font-medium">
                {t.parsedArtist} — {t.parsedTitle}
                {t.mixVersion && (
                  <span className="ml-1 text-[var(--color-muted)]">({t.mixVersion})</span>
                )}
              </p>
            ) : (
              <p className="truncate text-sm font-medium text-amber-300/90" title="Low-confidence parse — click to fix">
                {t.rawTitle}
              </p>
            )}
            <p className="truncate text-xs text-[var(--color-muted)]">
              {t.parsedArtist && t.parsedTitle ? (
                <>
                  raw: <span className="opacity-80">{t.rawTitle}</span>
                </>
              ) : (
                <span className="text-amber-400/80">needs review</span>
              )}
              {t.releaseYear && <span> · {t.releaseYear}</span>}
              {t.isAlreadyInLibrary && (
                <span className="ml-2 rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-300">
                  in library
                </span>
              )}
            </p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_PILL[t.status].tone}`}>
            {STATUS_PILL[t.status].label}
          </span>
        </li>
      ))}
    </ul>
  )
}
