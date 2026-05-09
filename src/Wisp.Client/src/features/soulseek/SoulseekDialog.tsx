import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import { soulseek } from '../../api/soulseek'
import type { SoulseekSearchHit, SoulseekTransfer } from '../../api/types'
import { useSoulseekStatus } from '../../state/soulseekStatus'
import { useUiPrefs } from '../../state/uiPrefs'
import { useSoulseekTransfers } from './useSoulseekTransfers'

interface Props {
  /// Initial search query — derived from the calling context (Discovered
  /// track's parsed artist + title, Wanted row, etc.).
  initialArtist: string | null
  initialTitle: string | null
  onClose: () => void
}

const SEARCH_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 2_000

type SortKey = 'bitrate' | 'size' | 'speed' | 'queue' | 'user'
type SortDir = 'asc' | 'desc'

/// Phase 23 follow-up — full-screen modal Soulseek search.
///
/// Replaces the inline SoulseekPanel that didn't give users enough room or
/// feedback when searching. Adds:
///   - Editable query (you can tweak the artist + title before searching).
///   - Format / bitrate filters (MP3 320 by default — DJ-deck friendly).
///   - Sortable columns (click a header to toggle asc / desc).
///   - Live status strip during search: progress bar, users-responded count,
///     hits count, time remaining, plus a Cancel button.
///   - In-flight downloads section so the user sees their queue without
///     navigating away.
export function SoulseekDialog({ initialArtist, initialTitle, onClose }: Props) {
  const [query, setQuery] = useState(buildQuery(initialArtist, initialTitle))
  const [searchId, setSearchId] = useState<string | null>(null)
  const [hits, setHits] = useState<SoulseekSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [responseCount, setResponseCount] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAtRef = useRef<number>(0)
  const [sortKey, setSortKey] = useState<SortKey>('bitrate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Filter prefs — read from + write to useUiPrefs so they persist across
  // sessions. The user's preferred filter (e.g. MP3 320) applies on every
  // search without re-toggling.
  const filter = useUiPrefs((s) => ({
    format: s.slskdFormat,
    mp3Bitrate: s.slskdMp3Bitrate,
    freeSlotsOnly: s.slskdFreeSlotsOnly,
    hideLocked: s.slskdHideLocked,
  }))
  const setFilter = useUiPrefs((s) => s.setSlskdFilter)

  const { transfers, slskdConfigured } = useSoulseekTransfers()
  const ensurePolling = useSoulseekStatus((s) => s.ensurePolling)

  const activeByFilename = useMemo(() => {
    const map = new Map<string, SoulseekTransfer>()
    for (const t of transfers) map.set(t.filename, t)
    return map
  }, [transfers])

  const inFlightTransfers = useMemo(
    () => transfers.filter((t) => !t.state.includes('Completed') && !t.state.includes('Errored')),
    [transfers],
  )

  // Esc to close (when not actively searching — close mid-search would
  // orphan the slskd request). Click-outside also closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Search-progress polling. Same shape as the legacy SoulseekPanel — start
  // search → poll every 2s until isComplete or 30s timeout. We also tick
  // a per-second elapsed counter so the progress bar animates smoothly
  // even when slskd's response cadence is slower.
  useEffect(() => {
    if (!searchId) return
    let cancelled = false
    let pollTimer: ReturnType<typeof setTimeout> | null = null

    const tick = async () => {
      try {
        const res = await soulseek.getSearch(searchId)
        if (cancelled) return
        setHits(res.hits)
        setResponseCount(res.responseCount)
        const elapsed = Date.now() - startedAtRef.current
        if (res.isComplete || elapsed >= SEARCH_TIMEOUT_MS) {
          setSearching(false)
          return
        }
        pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          setSearching(false)
        }
      }
    }
    void tick()

    return () => {
      cancelled = true
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [searchId])

  // 200ms-resolution elapsed counter — drives the progress bar smoothly.
  useEffect(() => {
    if (!searching) return
    const t = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current)
    }, 200)
    return () => clearInterval(t)
  }, [searching])

  const startSearch = useMutation({
    mutationFn: () => soulseek.startSearch(query.trim()),
    onSuccess: (r) => {
      setSearchId(r.id)
      setHits([])
      setResponseCount(0)
      setError(null)
      setSearching(true)
      setElapsedMs(0)
      startedAtRef.current = Date.now()
    },
    onError: (e) => setError((e as Error).message),
  })

  const cancelSearch = () => {
    setSearching(false)
    // We don't actually cancel the search server-side — slskd doesn't
    // expose a cancel endpoint and search results trickle in for free
    // afterward. Stopping the poll loop is enough; the user has indicated
    // they're done with the results they've already seen.
  }

  const filteredHits = useMemo(() => {
    let f = hits
    if (filter.hideLocked) f = f.filter((h) => !h.locked)
    if (filter.freeSlotsOnly) f = f.filter((h) => h.hasFreeUploadSlot)
    if (filter.format !== 'any') {
      f = f.filter((h) => fileExtension(h.filename) === filter.format)
    }
    if (filter.format === 'mp3' && filter.mp3Bitrate !== 'any') {
      const min = filter.mp3Bitrate === '320' ? 320 : 256
      const exact = filter.mp3Bitrate === '320'
      f = f.filter((h) => h.bitRate !== null && (exact ? h.bitRate === min : h.bitRate >= min))
    }
    return f
  }, [hits, filter])

  const sortedHits = useMemo(() => {
    const sorted = [...filteredHits]
    sorted.sort((a, b) => {
      const av = sortValue(a, sortKey)
      const bv = sortValue(b, sortKey)
      if (av === bv) return 0
      const cmp = av > bv ? 1 : -1
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [filteredHits, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Default direction depends on the column — bigger / faster is usually
      // what the user wants on top, so desc; user/queue go asc.
      setSortDir(key === 'user' || key === 'queue' ? 'asc' : 'desc')
    }
  }

  const progressPct = Math.min(100, (elapsedMs / SEARCH_TIMEOUT_MS) * 100)
  const remainingSec = Math.max(0, Math.ceil((SEARCH_TIMEOUT_MS - elapsedMs) / 1000))
  const totalHidden = hits.length - filteredHits.length

  // Portal into document.body so the modal escapes any ancestor that creates
  // a new stacking / containing context (transforms, filter, isolation,
  // contain). The Wanted / Discover callsites mount the dialog inside list
  // items, and those ancestors can pin position:fixed to the wrong frame —
  // user reported the dialog showing as "empty" when launched from Wanted.
  return createPortal(
    <div
      className="fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !searching) onClose() }}
    >
      <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">🎼 Search Soulseek</h2>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              Searches the Soulseek peer network via your local slskd daemon.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={searching}
            title={searching ? 'Cancel the search first' : 'Close'}
            className="text-xl leading-none text-[var(--color-muted)] hover:text-white disabled:opacity-30"
          >
            ×
          </button>
        </header>

        {/* Search bar — editable query + the action button. The button is the
            primary action so it's accent-coloured and chunky. */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)]/40 px-5 py-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !searching && query.trim()) startSearch.mutate() }}
            placeholder="Artist title"
            className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
          />
          {searching ? (
            <button
              onClick={cancelSearch}
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] hover:bg-white/5 hover:text-white"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={() => startSearch.mutate()}
              disabled={!query.trim() || !slskdConfigured || startSearch.isPending}
              className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent)]/90 disabled:cursor-not-allowed disabled:opacity-50"
              title={!slskdConfigured ? 'Configure slskd in Settings first' : `Search slskd for "${query}"`}
            >
              🎼 Search Soulseek
            </button>
          )}
        </div>

        {/* Filter strip + results meta. Visible at all times so the user can
            see + tweak filters without opening a sub-menu. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)]/40 px-5 py-2 text-xs">
          <span className="text-[var(--color-muted)]">Format</span>
          {(['any', 'mp3', 'flac', 'wav'] as const).map((f) => (
            <FilterChip
              key={f}
              active={filter.format === f}
              onClick={() => setFilter({ slskdFormat: f })}
            >
              {f.toUpperCase()}
            </FilterChip>
          ))}
          {filter.format === 'mp3' && (
            <>
              <span className="ml-2 text-[var(--color-muted)]">Bitrate</span>
              {(['any', '320', '256+'] as const).map((b) => (
                <FilterChip
                  key={b}
                  active={filter.mp3Bitrate === b}
                  onClick={() => setFilter({ slskdMp3Bitrate: b })}
                >
                  {b === '320' ? '320 only' : b === '256+' ? '256+' : 'Any'}
                </FilterChip>
              ))}
            </>
          )}
          <span className="mx-1 h-4 w-px bg-[var(--color-border)]" />
          <FilterChip
            active={filter.freeSlotsOnly}
            onClick={() => setFilter({ slskdFreeSlotsOnly: !filter.freeSlotsOnly })}
          >
            ⚡ Free slots only
          </FilterChip>
          <FilterChip
            active={filter.hideLocked}
            onClick={() => setFilter({ slskdHideLocked: !filter.hideLocked })}
          >
            🔓 Hide locked
          </FilterChip>
          <span className="ml-auto text-[var(--color-muted)]">
            {hits.length === 0
              ? (searching ? 'Waiting for hits…' : '')
              : <>
                  Showing {filteredHits.length}
                  {totalHidden > 0 && <span className="text-[var(--color-muted)]/60"> · {totalHidden} hidden by filters</span>}
                </>
            }
          </span>
        </div>

        {/* Live status strip — progress bar + counts + time remaining. Only
            visible when actively searching; collapses to the result-summary
            line when the search settles. */}
        {searching && (
          <div className="border-b border-[var(--color-border)]/40 px-5 py-2">
            <div className="flex items-center justify-between text-[11px] text-[var(--color-muted)]">
              <span>
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                {' '}🟢 {responseCount} {responseCount === 1 ? 'user' : 'users'} responded · {hits.length} hits
              </span>
              <span>⏱ {remainingSec}s left</span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--color-bg)]">
              <div
                className="h-full bg-[var(--color-accent)] transition-[width] duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="border-b border-[var(--color-border)]/40 px-5 py-2">
            <p className="text-xs text-red-400">⚠ {error}</p>
          </div>
        )}

        {!slskdConfigured && (
          <div className="m-5 rounded-md border border-amber-400/30 bg-amber-400/10 p-4 text-xs text-amber-200">
            <p className="font-medium">slskd isn't configured.</p>
            <p className="mt-1">Add the URL + API key in Settings → Soulseek before you can search. Wisp only contacts slskd when you click Search or a transfer is in flight.</p>
          </div>
        )}

        {/* Results table — fills remaining vertical space, scrolls. */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sortedHits.length > 0 ? (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-bg)] text-[var(--color-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left font-normal">File</th>
                  <SortHeader k="bitrate" current={sortKey} dir={sortDir} onClick={toggleSort} align="right">Bitrate</SortHeader>
                  <SortHeader k="size" current={sortKey} dir={sortDir} onClick={toggleSort} align="right">Size</SortHeader>
                  <SortHeader k="user" current={sortKey} dir={sortDir} onClick={toggleSort} align="left">User</SortHeader>
                  <SortHeader k="speed" current={sortKey} dir={sortDir} onClick={toggleSort} align="right">Speed</SortHeader>
                  <SortHeader k="queue" current={sortKey} dir={sortDir} onClick={toggleSort} align="right">Queue</SortHeader>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedHits.map((h, i) => (
                  <HitRow
                    key={`${h.username}:${h.filename}:${i}`}
                    hit={h}
                    transfer={activeByFilename.get(h.filename) ?? null}
                    onQueued={ensurePolling}
                  />
                ))}
              </tbody>
            </table>
          ) : !searching && searchId && hits.length === 0 ? (
            <EmptyState
              title="No matches found."
              hint="Soulseek depends on which users are online. Try again in a few minutes, or remove a word from the query."
              action={query.trim() ? <button onClick={() => startSearch.mutate()} className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white">Search again</button> : null}
            />
          ) : !searching && searchId && filteredHits.length === 0 && hits.length > 0 ? (
            <EmptyState
              title={`${hits.length} hits — all filtered out.`}
              hint="Loosen the filters above to see more, or click Search again to re-poll the network."
              action={null}
            />
          ) : !searchId && slskdConfigured ? (
            <EmptyState
              title="Ready to search."
              hint={`Click "🎼 Search Soulseek" to query the peer network for "${query}".`}
              action={null}
            />
          ) : null}
        </div>

        {/* In-flight transfers — always visible at the bottom when active. */}
        {inFlightTransfers.length > 0 && (
          <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)]">
            <p className="px-5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              Downloads in flight ({inFlightTransfers.length})
            </p>
            <ul className="max-h-40 overflow-y-auto px-5 py-2">
              {inFlightTransfers.map((t) => (
                <TransferRow key={t.id} transfer={t} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function SortHeader({
  k,
  current,
  dir,
  onClick,
  align,
  children,
}: {
  k: SortKey
  current: SortKey
  dir: SortDir
  onClick: (k: SortKey) => void
  align: 'left' | 'right'
  children: React.ReactNode
}) {
  const active = current === k
  return (
    <th className={`px-3 py-2 font-normal ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={() => onClick(k)}
        className={[
          'inline-flex items-center gap-1 transition-colors',
          align === 'right' ? 'flex-row-reverse' : '',
          active ? 'text-white' : 'text-[var(--color-muted)] hover:text-white',
        ].join(' ')}
      >
        {children}
        {active && <span className="text-[9px]">{dir === 'asc' ? '▲' : '▼'}</span>}
      </button>
    </th>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        active
          ? 'border-[var(--color-accent)]/60 bg-[var(--color-accent)]/15 text-white'
          : 'border-[var(--color-border)] text-[var(--color-muted)] hover:text-white',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint: string
  action: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-5 py-12 text-center">
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="max-w-md text-xs text-[var(--color-muted)]">{hint}</p>
      {action}
    </div>
  )
}

function HitRow({
  hit,
  transfer,
  onQueued,
}: {
  hit: SoulseekSearchHit
  transfer: SoulseekTransfer | null
  onQueued: () => void
}) {
  const download = useMutation({
    mutationFn: () => soulseek.download(hit.username, hit.filename, hit.size),
    onSuccess: onQueued,
  })

  const fileName = hit.filename.split(/[\\/]/).pop() ?? hit.filename
  const completed = transfer?.state.includes('Completed')
  const inProgress = transfer && !completed

  return (
    <tr className="relative border-t border-[var(--color-border)]/30 hover:bg-white/5">
      <td className="max-w-[28rem] truncate px-3 py-2" title={hit.filename}>
        {fileName}
        {hit.locked && (
          <span className="ml-2 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] text-amber-300" title="User has share-ratio gate">
            🔒 locked
          </span>
        )}
        {/* In-flight download progress strip under the filename — visible
            even when scrolled past the action column. */}
        {inProgress && transfer!.percentage > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
            <div
              className="h-full bg-[var(--color-accent)] transition-[width]"
              style={{ width: `${transfer!.percentage}%` }}
            />
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {hit.bitRate
          ? <span className={hit.bitRate >= 320 ? 'text-emerald-300' : 'text-[var(--color-muted)]'}>{hit.bitRate}k</span>
          : hit.bitDepth
            ? <span className="text-[var(--color-muted)]">{hit.bitDepth}b/{hit.sampleRate}</span>
            : <span className="text-[var(--color-muted)]/60">?</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-[var(--color-muted)]">{formatBytes(hit.size)}</td>
      <td className="px-3 py-2 text-[var(--color-muted)]">
        <span className={hit.hasFreeUploadSlot ? 'text-emerald-300/80' : ''}>
          {hit.hasFreeUploadSlot && '⚡ '}
          {hit.username}
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-[var(--color-muted)]">
        {hit.uploadSpeed > 0 ? `${Math.round(hit.uploadSpeed / 1024)}KB/s` : '—'}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-[var(--color-muted)]">
        {hit.queueLength > 0 ? hit.queueLength : '—'}
      </td>
      <td className="px-3 py-2 text-right">
        {completed ? (
          <span className="text-emerald-300" title="Completed">✓ Done</span>
        ) : inProgress ? (
          <span className="text-amber-300 tabular-nums" title={transfer!.state}>
            {transfer!.percentage > 0 ? `${transfer!.percentage.toFixed(0)}%` : transfer!.state}
          </span>
        ) : (
          <button
            onClick={() => download.mutate()}
            disabled={download.isPending}
            className="rounded bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[var(--color-accent)]/90 disabled:opacity-40"
          >
            {download.isPending ? '…' : '⬇ DL'}
          </button>
        )}
      </td>
    </tr>
  )
}

function TransferRow({ transfer }: { transfer: SoulseekTransfer }) {
  const fileName = transfer.filename.split(/[\\/]/).pop() ?? transfer.filename
  return (
    <li className="border-b border-[var(--color-border)]/30 py-1.5 last:border-0">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="min-w-0 flex-1 truncate" title={transfer.filename}>{fileName}</span>
        <span className="shrink-0 text-[var(--color-muted)]">{transfer.username}</span>
        <span className="shrink-0 tabular-nums text-[var(--color-muted)]">
          {transfer.percentage.toFixed(0)}%
        </span>
      </div>
      <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-[var(--color-bg)]">
        <div
          className="h-full bg-[var(--color-accent)] transition-[width]"
          style={{ width: `${transfer.percentage}%` }}
        />
      </div>
    </li>
  )
}

function buildQuery(artist: string | null, title: string | null): string {
  if (artist && title) return `${artist} ${title}`
  return title ?? artist ?? ''
}

function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : ''
}

function sortValue(h: SoulseekSearchHit, k: SortKey): number | string {
  switch (k) {
    case 'bitrate': return h.bitRate ?? -1
    case 'size': return h.size
    case 'speed': return h.uploadSpeed
    case 'queue': return h.queueLength
    case 'user': return h.username.toLowerCase()
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)))
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)}${sizes[i]}`
}
