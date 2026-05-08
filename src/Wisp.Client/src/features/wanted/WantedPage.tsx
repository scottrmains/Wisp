import { useState } from 'react'
import type { WantedTrack } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { confirmDialog } from '../../components/dialog'
import { SoulseekPanel } from '../cratedigger/SoulseekPanel'
import { useWantedTracks } from './useWantedTracks'

/// Single timeline-sorted page for everything the user has marked Want from
/// anywhere in the app. Source badges differentiate where each row came
/// from. Found-in-library items stick around (with a ✓ in library chip)
/// rather than auto-disappearing — confirms the success.
export function WantedPage() {
  const { items, loading, remove } = useWantedTracks()
  const [hideFound, setHideFound] = useState(false)
  const [slskdFor, setSlskdFor] = useState<string | null>(null) // wanted track id

  const visible = hideFound ? items.filter((w) => !w.matchedLocalTrackId) : items
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
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Wanted</h1>
          <p className="text-xs text-[var(--color-muted)]">
            Tracks you've marked Want from Discover or Crate Digger. Anything in this list that
            shows up in a future library scan gets a <span className="text-emerald-300">✓ in library</span> chip.
          </p>
        </div>
        {foundCount > 0 && (
          <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={hideFound}
              onChange={(e) => setHideFound(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Hide found ({foundCount})
          </label>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {loading && <p className="text-sm text-[var(--color-muted)]">Loading wanted tracks…</p>}
        {!loading && items.length === 0 && (
          <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-sm text-[var(--color-muted)]">
            <p className="text-white">Nothing wanted yet.</p>
            <p className="mt-1">
              Mark <strong>Want</strong> on any result in <strong>Discover</strong> or <strong>Crate Digger</strong> and
              it'll collect here. The next time a library scan finds the track, it'll auto-flag as in-library.
            </p>
          </div>
        )}
        {!loading && visible.length === 0 && items.length > 0 && (
          <p className="text-sm text-[var(--color-muted)]">All wanted tracks are now in your library — toggle "Hide found" to see them.</p>
        )}
        <ul className="space-y-2">
          {visible.map((w) => (
            <li
              key={w.id}
              className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]"
            >
              <div className="flex items-center gap-3 p-3">
                {w.thumbnailUrl ? (
                  <img src={w.thumbnailUrl} alt="" className="h-12 w-16 shrink-0 rounded object-cover" />
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
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        ✓ in library
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {w.sourceUrl && bridgeAvailable() && (
                    <button
                      onClick={() => bridge.openExternal(w.sourceUrl!)}
                      className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-white"
                      title="Open source"
                    >
                      ↗
                    </button>
                  )}
                  <button
                    onClick={() => setSlskdFor(slskdFor === w.id ? null : w.id)}
                    className="rounded border border-[var(--color-accent)]/40 px-2 py-1 text-xs text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
                    title="Search Soulseek"
                  >
                    {slskdFor === w.id ? '▾ Soulseek' : '🎼 Soulseek'}
                  </button>
                  <button
                    onClick={() => handleRemove(w)}
                    className="rounded border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-muted)] hover:text-red-300"
                    title="Remove from Wanted"
                  >
                    ✕
                  </button>
                </div>
              </div>
              {slskdFor === w.id && (
                <div className="border-t border-[var(--color-border)] px-3 pb-3">
                  <SoulseekPanel artist={w.artist} title={w.title} />
                </div>
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
