import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import { soulseek } from '../../api/soulseek'
import type { SoulseekSearchHit, SoulseekTransfer } from '../../api/types'

interface Props {
  artist: string | null
  title: string | null
}

const SEARCH_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 2_000

export function SoulseekPanel({ artist, title }: Props) {
  const [searchId, setSearchId] = useState<string | null>(null)
  const [hits, setHits] = useState<SoulseekSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [responseCount, setResponseCount] = useState(0)
  // We only start polling /api/soulseek/downloads after the user actually queues
  // one — no point hammering slskd otherwise (and no point at all if slskd is down).
  const [transferPollingActive, setTransferPollingActive] = useState(false)
  const startedAtRef = useRef<number>(0)

  const query = (artist && title)
    ? `${artist} ${title}`
    : (title ?? artist ?? '')

  // Soulseek configured? Cheap one-shot — gates every other slskd network call.
  const status = useQuery({
    queryKey: ['soulseek-status'],
    queryFn: () => apiGet<{ isConfigured: boolean }>('/api/settings/soulseek'),
    staleTime: 60_000,
  })
  const slskdConfigured = status.data?.isConfigured ?? false

  // Poll the search until complete or until we time out.
  useEffect(() => {
    if (!searchId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

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
        timer = setTimeout(tick, POLL_INTERVAL_MS)
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
      if (timer) clearTimeout(timer)
    }
  }, [searchId])

  // Active downloads — only poll when slskd is configured AND we've actually started a transfer.
  // Stops automatically when nothing is in-flight anymore.
  const transfers = useQuery({
    queryKey: ['soulseek-downloads'],
    queryFn: () => soulseek.listDownloads(),
    enabled: slskdConfigured && transferPollingActive,
    refetchInterval: (q) => {
      const data = q.state.data ?? []
      const stillActive = data.some((t) => !t.state.includes('Completed'))
      if (!stillActive) {
        // Schedule a state flip on next tick so we stop polling cleanly.
        setTimeout(() => setTransferPollingActive(false), 0)
        return false
      }
      return POLL_INTERVAL_MS
    },
    // If slskd is off or refuses, don't keep retrying — fail once and back off.
    retry: false,
  })

  const activeByFilename = new Map<string, SoulseekTransfer>()
  for (const t of transfers.data ?? []) activeByFilename.set(t.filename, t)

  const startSearch = useMutation({
    mutationFn: () => soulseek.startSearch(query),
    onSuccess: (r) => {
      setSearchId(r.id)
      setHits([])
      setResponseCount(0)
      setError(null)
      setSearching(true)
      startedAtRef.current = Date.now()
    },
    onError: (e) => setError((e as Error).message),
  })

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Soulseek (slskd)
        </h3>
        <button
          onClick={() => startSearch.mutate()}
          disabled={!query.trim() || !slskdConfigured || startSearch.isPending || searching}
          className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] hover:bg-white/5 disabled:opacity-40"
          title={
            !slskdConfigured
              ? 'Configure slskd in Settings first'
              : !query.trim()
                ? 'Set artist + title first'
                : `Search slskd for "${query}"`
          }
        >
          {searching ? `Searching… (${responseCount} users)` : 'Search Soulseek'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {!slskdConfigured && (
        <p className="text-xs text-[var(--color-muted)]">
          Configure slskd URL + API key in Settings. Wisp will only contact slskd when you click Search or while a download is in flight — close it any time you're not using it.
        </p>
      )}

      {slskdConfigured && !searchId && !error && (
        <p className="text-xs text-[var(--color-muted)]">
          Searches the Soulseek peer network via your local slskd daemon. Start slskd before clicking Search.
        </p>
      )}

      {hits.length > 0 && (
        <div className="mt-2 max-h-72 overflow-y-auto rounded border border-[var(--color-border)]">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[var(--color-bg)] text-[var(--color-muted)]">
              <tr>
                <th className="px-2 py-1 text-left font-normal">File</th>
                <th className="px-2 py-1 text-right font-normal">Size</th>
                <th className="px-2 py-1 text-right font-normal">Bitrate</th>
                <th className="px-2 py-1 text-left font-normal">User</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {hits.slice(0, 100).map((h, i) => (
                <HitRow
                  key={`${h.username}:${h.filename}:${i}`}
                  hit={h}
                  transfer={activeByFilename.get(h.filename) ?? null}
                  onQueued={() => setTransferPollingActive(true)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {searchId && !searching && hits.length === 0 && (
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          No results. Soulseek searches depend on which users are online — try again in a few minutes.
        </p>
      )}
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
    <tr className="border-t border-[var(--color-border)]/30">
      <td className="max-w-[18rem] truncate px-2 py-1" title={hit.filename}>
        {fileName}
        {hit.locked && (
          <span className="ml-1.5 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] text-amber-300" title="User has share-ratio gate">
            locked
          </span>
        )}
      </td>
      <td className="px-2 py-1 text-right tabular-nums text-[var(--color-muted)]">{formatBytes(hit.size)}</td>
      <td className="px-2 py-1 text-right tabular-nums text-[var(--color-muted)]">
        {hit.bitRate ? `${hit.bitRate}k` : hit.bitDepth ? `${hit.bitDepth}b/${hit.sampleRate}` : '?'}
      </td>
      <td className="px-2 py-1 text-[var(--color-muted)]">
        {hit.username}
        {hit.uploadSpeed > 0 && (
          <span className="ml-1 text-[9px]">{Math.round(hit.uploadSpeed / 1024)}KB/s</span>
        )}
      </td>
      <td className="px-2 py-1 text-right">
        {completed ? (
          <span className="text-emerald-300">✓</span>
        ) : inProgress ? (
          <span className="text-amber-300" title={transfer!.state}>
            {transfer!.percentage > 0 ? `${transfer!.percentage.toFixed(0)}%` : transfer!.state}
          </span>
        ) : (
          <button
            onClick={() => download.mutate()}
            disabled={download.isPending}
            className="rounded bg-[var(--color-accent)] px-2 py-0.5 text-[10px] text-white disabled:opacity-40"
          >
            {download.isPending ? '…' : 'DL'}
          </button>
        )}
      </td>
    </tr>
  )
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)))
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)}${sizes[i]}`
}
