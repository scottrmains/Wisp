import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import {
  AlertTriangle,
  Check,
  Clock,
  Disc3,
  Download,
  Lock,
  Search as SearchIcon,
  X,
  Zap,
} from 'lucide-react'
import { soulseek } from '../../api/soulseek'
import type { SoulseekSearchHit, SoulseekTransfer } from '../../api/types'
import { useSoulseekStatus } from '../../state/soulseekStatus'
import { useUiPrefs } from '../../state/uiPrefs'
import { useSoulseekTransfers } from './useSoulseekTransfers'
import { SoulseekTransferList } from './SoulseekTransferList'
import { transferState } from './transferState'
import { useSearchSession } from './searchSession'

interface Props {
  /// Initial search query — derived from the calling context (Discovered
  /// track's parsed artist + title, Wanted row, etc.).
  initialArtist: string | null
  initialTitle: string | null
  onClose: () => void
  embedded?: boolean
  networkReady?: boolean
}

const SEARCH_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 2_000

type SortKey = 'bitrate' | 'size' | 'speed' | 'queue' | 'user' | 'file' | 'duration'
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
export function SoulseekDialog({ initialArtist, initialTitle, onClose, embedded = false, networkReady = true }: Props) {
  const [snapshot] = useState(() => embedded ? useSearchSession.getState().snapshot : null)
  const [query, setQuery] = useState(snapshot?.query ?? buildQuery(initialArtist, initialTitle))
  const [searchId, setSearchId] = useState<string | null>(snapshot?.searchId ?? null)
  const [hits, setHits] = useState<SoulseekSearchHit[]>(snapshot?.hits ?? [])
  const [searching, setSearching] = useState(snapshot?.searching ?? false)
  const [error, setError] = useState<string | null>(null)
  const [responseCount, setResponseCount] = useState(snapshot?.responseCount ?? 0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const startedAtRef = useRef<number>(snapshot?.startedAt ?? 0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const queueNotice = useSearchSession(s => s.queueNotice)
  const setQueueNotice = useSearchSession(s => s.setQueueNotice)
  const stopBatch = useRef(false)
  const [sortKey, setSortKey] = useState<SortKey>('bitrate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Filter prefs — read from + write to useUiPrefs so they persist across
  // sessions. Selectors are split into separate calls so Zustand's default
  // Object.is equality holds; the previous combined-object selector
  // returned a fresh reference every render and caused render churn / a
  // black-screen on the Wanted page → Soulseek path.
  const format = useUiPrefs((s) => s.slskdFormat)
  const mp3Bitrate = useUiPrefs((s) => s.slskdMp3Bitrate)
  const freeSlotsOnly = useUiPrefs((s) => s.slskdFreeSlotsOnly)
  const hideLocked = useUiPrefs((s) => s.slskdHideLocked)
  const setFilter = useUiPrefs((s) => s.setSlskdFilter)
  const filter = useMemo(() => ({ format, mp3Bitrate, freeSlotsOnly, hideLocked }), [format, mp3Bitrate, freeSlotsOnly, hideLocked])

  const { transfers, slskdConfigured, error: transferError, refresh } = useSoulseekTransfers()
  const ensurePolling = useSoulseekStatus((s) => s.ensurePolling)

  const activeByFilename = useMemo(() => {
    const map = new Map<string, SoulseekTransfer>()
    for (const t of transfers) map.set(JSON.stringify([t.username, t.filename]), t)
    return map
  }, [transfers])

  useEffect(() => {
    if (embedded) useSearchSession.getState().save({ query, searchId, hits, searching, responseCount, startedAt: startedAtRef.current })
  }, [embedded, query, searchId, hits, searching, responseCount])

  // Esc to close (when not actively searching — close mid-search would
  // orphan the slskd request). Click-outside also closes.
  useEffect(() => {
    if (embedded) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !searching) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, embedded, searching])

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
          if (!res.isComplete) void soulseek.stopSearch(searchId).catch(e => { if (!cancelled) setError((e as Error).message) })
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
    mutationFn: async () => {
      if (searchId) {
        await soulseek.stopSearch(searchId)
        await soulseek.deleteSearch(searchId)
      }
      return soulseek.startSearch(query.trim())
    },
    onSuccess: (r) => {
      setSearchId(r.id)
      setHits([])
      setResponseCount(0)
      setError(null)
      setSelected(new Set())
      setQueueNotice(null)
      setSearching(true)
      setElapsedMs(0)
      startedAtRef.current = Date.now()
    },
    onError: (e) => setError((e as Error).message),
  })

  const stopSearch = useMutation({
    mutationFn: async () => { if (searchId) { await soulseek.stopSearch(searchId); await soulseek.deleteSearch(searchId) } },
    onSuccess: () => { setSearching(false); setSearchId(null) },
    onError: e => setError((e as Error).message),
  })
  const cancelSearch = () => stopSearch.mutate()

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

  const downloadable = sortedHits.filter(hit => {
    const transfer = activeByFilename.get(hitKey(hit))
    return !hit.locked && (!transfer || (transferState(transfer.state).finished && !transferState(transfer.state).succeeded))
  })
  const selectedHits = downloadable.filter(hit => selected.has(hitKey(hit)))
  const batch = useMutation({
    mutationKey: ['soulseek-queue'],
    onMutate: () => { stopBatch.current = false; setQueueNotice(null) },
    mutationFn: async () => {
      const errors: string[] = []
      let queued = 0
      for (const hit of selectedHits) {
        if (stopBatch.current) break
        try { await soulseek.download(hit.username, hit.filename, hit.size); queued++; ensurePolling() }
        catch (e) { errors.push(`${hit.filename.split(/[\\/]/).pop()}: ${(e as Error).message}`) }
      }
      return { queued, errors, stopped: stopBatch.current }
    },
    onSuccess: async result => {
      setQueueNotice([`${result.queued} ${result.queued === 1 ? 'file' : 'files'} queued.`, result.stopped ? 'Stopped queueing. Already queued downloads continue.' : '', ...result.errors].filter(Boolean).join(' '))
      setSelected(new Set())
      await refresh()
    },
  })

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Default direction depends on the column — bigger / faster is usually
      // what the user wants on top, so desc; user/queue go asc.
      setSortDir(key === 'user' || key === 'queue' || key === 'file' ? 'asc' : 'desc')
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
  const workspace = (
    <div
      className={embedded ? 'h-full min-h-0' : 'fixed inset-0 z-[1500] flex items-center justify-center bg-black/70 p-4'}
      onClick={(e) => { if (e.target === e.currentTarget && !searching) onClose() }}
    >
      <div className={embedded ? 'flex h-full min-h-0 flex-col' : 'flex h-[90vh] w-full max-w-5xl flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl'}>
        {!embedded && <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="inline-flex items-center gap-2 text-base font-semibold">
              <Disc3 size={16} strokeWidth={1.75} /> Search Soulseek
            </h2>
            <p className="mt-0.5 text-xs text-[var(--color-muted)]">
              Searches the Soulseek peer network via your local slskd daemon.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={searching}
            title={searching ? 'Cancel the search first' : 'Close'}
            className="text-[var(--color-muted)] hover:text-white disabled:opacity-30"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>}

        {/* Search bar — editable query + the action button. The button is the
            primary action so it's accent-coloured and chunky. */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)]/40 px-5 py-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !searching && !startSearch.isPending && slskdConfigured && networkReady && query.trim()) startSearch.mutate() }}
            placeholder="Search an artist, track or release…"
            aria-label="Soulseek search query"
            disabled={startSearch.isPending}
            className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm focus:border-[var(--color-accent)] focus:outline-none"
          />
          {searching ? (
            <button
              onClick={cancelSearch}
              disabled={stopSearch.isPending}
              className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] hover:bg-white/5 hover:text-white"
            >
              {stopSearch.isPending ? 'Stopping…' : 'Stop search'}
            </button>
          ) : (
            <button
              onClick={() => startSearch.mutate()}
              disabled={!query.trim() || !slskdConfigured || !networkReady || startSearch.isPending}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent)]/90 disabled:cursor-not-allowed disabled:opacity-50"
              title={!slskdConfigured ? 'Configure slskd in Settings first' : `Search slskd for "${query}"`}
            >
              <SearchIcon size={14} strokeWidth={2} /> Search Soulseek
            </button>
          )}
        </div>

        {/* Filter strip + results meta. Visible at all times so the user can
            see + tweak filters without opening a sub-menu. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)]/40 px-5 py-2 text-xs">
          <span className="text-[var(--color-muted)]">Format</span>
          {(['any', 'mp3', 'flac', 'wav', 'aiff'] as const).map((f) => (
            <FilterChip
              key={f}
              active={filter.format === f}
              onClick={() => setFilter({ slskdFormat: f })}
            >
              {f === 'any' ? 'All formats' : f.toUpperCase()}
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
            <Zap size={11} strokeWidth={1.75} /> Free slots only
          </FilterChip>
          <FilterChip
            active={filter.hideLocked}
            onClick={() => setFilter({ slskdHideLocked: !filter.hideLocked })}
          >
            <Lock size={11} strokeWidth={1.75} /> Hide locked
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
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                {responseCount} {responseCount === 1 ? 'user' : 'users'} responded · {hits.length} hits
              </span>
              <span className="inline-flex items-center gap-1"><Clock size={11} strokeWidth={1.75} /> {remainingSec}s left</span>
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
            <p className="inline-flex items-center gap-1.5 text-xs text-red-400"><AlertTriangle size={12} strokeWidth={1.75} /> {error}</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-5 py-2 text-xs">
          <span className="text-[var(--color-muted)]">{selectedHits.length} selected</span>
          <button onClick={() => batch.mutate()} disabled={!selectedHits.length || batch.isPending}
            className="inline-flex items-center gap-2 rounded bg-[var(--color-accent)] px-3 py-2 text-white disabled:opacity-40">
            <Download size={13} />{batch.isPending ? 'Queueing…' : 'Download selected'}
          </button>
          {batch.isPending && <button onClick={() => { stopBatch.current = true; setQueueNotice('Stopping after the current request. Downloads already queued will continue.') }}>Stop queueing</button>}
          {selected.size > 0 && <button onClick={() => setSelected(new Set())} disabled={batch.isPending}>Clear selection</button>}
          {queueNotice && <p role="status" className="min-w-0 flex-1 break-words">{queueNotice}</p>}
        </div>

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
              <thead className="sticky top-0 z-10 bg-[var(--color-bg)] text-[var(--color-muted)]">
                <tr>
                  <th className="px-3 py-2"><input type="checkbox" aria-label="Select all downloadable results" disabled={batch.isPending || !downloadable.length}
                    checked={downloadable.length > 0 && selectedHits.length === downloadable.length}
                    onChange={e => setSelected(e.target.checked ? new Set(downloadable.map(hitKey)) : new Set())} /></th>
                  <SortHeader k="file" current={sortKey} dir={sortDir} onClick={toggleSort} align="left">File</SortHeader>
                  <SortHeader k="duration" current={sortKey} dir={sortDir} onClick={toggleSort} align="right">Duration</SortHeader>
                  <SortHeader k="bitrate" current={sortKey} dir={sortDir} onClick={toggleSort} align="right">Bitrate</SortHeader>
                  <SortHeader k="size" current={sortKey} dir={sortDir} onClick={toggleSort} align="right">Size</SortHeader>
                  <SortHeader k="user" current={sortKey} dir={sortDir} onClick={toggleSort} align="left">User</SortHeader>
                  <SortHeader k="speed" current={sortKey} dir={sortDir} onClick={toggleSort} align="right">Speed</SortHeader>
                  <SortHeader k="queue" current={sortKey} dir={sortDir} onClick={toggleSort} align="right">Queue</SortHeader>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sortedHits.map((h) => (
                  <HitRow
                    key={hitKey(h)}
                    hit={h}
                    transfer={activeByFilename.get(JSON.stringify([h.username, h.filename])) ?? null}
                    onQueued={ensurePolling}
                    selected={selected.has(hitKey(h))} batchPending={batch.isPending}
                    onSelect={checked => setSelected(old => { const next = new Set(old); if (checked) next.add(hitKey(h)); else next.delete(hitKey(h)); return next })}
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
              hint={query ? `Search the files shared by users currently online for "${query}".` : 'Enter an artist, track or release above to search the files shared by users currently online.'}
              action={null}
            />
          ) : null}
        </div>

        {/* Share cancellation/history controls with the header transfers window. */}
        {!embedded && (transfers.length > 0 || transferError) && (
          <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)]">
            <p className="px-5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted)]">
              Downloads ({transfers.length})
            </p>
            <SoulseekTransferList transfers={transfers} error={transferError} />
          </div>
        )}
      </div>
    </div>
  )
  return embedded ? workspace : createPortal(workspace, document.body)
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
  selected, onSelect, batchPending,
}: {
  hit: SoulseekSearchHit
  transfer: SoulseekTransfer | null
  onQueued: () => void
  selected: boolean
  onSelect: (checked: boolean) => void
  batchPending: boolean
}) {
  const download = useMutation({
    mutationKey: ['soulseek-queue'],
    onMutate: () => useSearchSession.getState().setQueueNotice(null),
    mutationFn: () => soulseek.download(hit.username, hit.filename, hit.size),
    onSuccess: () => { onQueued(); useSearchSession.getState().setQueueNotice('File queued. Follow its progress in Downloads.') },
    onError: error => useSearchSession.getState().setQueueNotice(error.message),
  })

  const fileName = hit.filename.split(/[\\/]/).pop() ?? hit.filename
  const completed = transfer ? transferState(transfer.state).succeeded : false
  const inProgress = transfer && !transferState(transfer.state).finished

  return (
    <tr className="relative border-t border-[var(--color-border)]/30 hover:bg-white/5">
      <td className="px-3 py-2"><input type="checkbox" checked={selected} onChange={e => onSelect(e.target.checked)}
        disabled={hit.locked || !!inProgress || completed || batchPending || download.isPending} aria-label={`Select ${fileName} from ${hit.username}`} /></td>
      <td className="max-w-[28rem] truncate px-3 py-2" title={hit.filename}>
        {fileName}
        {download.error && <p role="alert" className="whitespace-normal text-red-300">{download.error.message}</p>}
        {hit.locked && (
          <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] text-amber-300" title="This user has restricted access to this file">
            <Lock size={9} strokeWidth={2} /> locked
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
      <td className="px-3 py-2 text-right tabular-nums text-[var(--color-muted)]">{hit.length != null ? `${Math.floor(hit.length / 60)}:${String(hit.length % 60).padStart(2, '0')}` : '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {hit.bitRate
          ? <span className={hit.bitRate >= 320 ? 'text-emerald-300' : 'text-[var(--color-muted)]'}>{hit.bitRate}k</span>
          : hit.bitDepth
            ? <span className="text-[var(--color-muted)]">{hit.bitDepth}b/{hit.sampleRate}</span>
            : <span className="text-[var(--color-muted)]/60">?</span>}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-[var(--color-muted)]">{formatBytes(hit.size)}</td>
      <td className="px-3 py-2 text-[var(--color-muted)]">
        <span className={`inline-flex items-center gap-1 ${hit.hasFreeUploadSlot ? 'text-emerald-300/80' : ''}`}>
          {hit.hasFreeUploadSlot && <Zap size={11} strokeWidth={2} />}
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
          <span className="inline-flex items-center gap-1 text-emerald-300" title="Completed"><Check size={12} strokeWidth={2} /> Done</span>
        ) : inProgress ? (
          <span className="text-amber-300 tabular-nums" title={transfer!.state}>
            {transfer!.percentage > 0 ? `${transfer!.percentage.toFixed(0)}%` : transfer!.state}
          </span>
        ) : (
          <button
            onClick={() => download.mutate()}
            disabled={download.isPending || hit.locked || batchPending}
            aria-label={`Download ${fileName} from ${hit.username}`}
            title={hit.locked ? 'This user has restricted access to this file' : 'Download this file'}
            className="inline-flex items-center gap-1 rounded bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[var(--color-accent)]/90 disabled:opacity-40"
          >
            {download.isPending ? '…' : <><Download size={11} strokeWidth={2} /> DL</>}
          </button>
        )}
      </td>
    </tr>
  )
}

function hitKey(hit: SoulseekSearchHit) { return JSON.stringify([hit.username, hit.filename]) }

function buildQuery(artist: string | null, title: string | null): string {
  if (artist && title) return `${artist} ${title}`
  return title ?? artist ?? ''
}

function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.')
  const extension = idx >= 0 ? filename.slice(idx + 1).toLowerCase() : ''
  return extension === 'aif' ? 'aiff' : extension
}

function sortValue(h: SoulseekSearchHit, k: SortKey): number | string {
  switch (k) {
    case 'bitrate': return h.bitRate ?? -1
    case 'size': return h.size
    case 'speed': return h.uploadSpeed
    case 'queue': return h.queueLength
    case 'user': return h.username.toLowerCase()
    case 'file': return (h.filename.split(/[\\/]/).pop() ?? h.filename).toLowerCase()
    case 'duration': return h.length ?? -1
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)))
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)}${sizes[i]}`
}
