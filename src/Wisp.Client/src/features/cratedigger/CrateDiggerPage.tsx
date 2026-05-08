import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { discovery, subscribeToDiscoveryScan } from '../../api/discovery'
import type { DiscoveredTrack, DiscoverySource, DiscoveryStatus } from '../../api/types'
import { DiscoveredTrackList } from './DiscoveredTrackList'
import { DiscoveredTrackDetail } from './DiscoveredTrackDetail'

interface Props {
  onClose: () => void
}

const STATUS_FILTERS: { label: string; value: DiscoveryStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'New', value: 'New' },
  { label: 'Want', value: 'Want' },
  { label: 'Already have', value: 'AlreadyHave' },
  { label: 'Possible match', value: 'PossibleMatch' },
  { label: 'Digital available', value: 'DigitalAvailable' },
  { label: 'Vinyl only', value: 'VinylOnly' },
  { label: 'No match', value: 'NoMatch' },
  { label: 'Ignored', value: 'Ignore' },
]

export function CrateDiggerPage({ onClose }: Props) {
  const qc = useQueryClient()
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<DiscoveryStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedTrack, setSelectedTrack] = useState<DiscoveredTrack | null>(null)

  const sources = useQuery({
    queryKey: ['discovery-sources'],
    queryFn: () => discovery.listSources(),
  })

  // Auto-select first source on load.
  useEffect(() => {
    if (!activeSourceId && sources.data && sources.data.length > 0) {
      setActiveSourceId(sources.data[0].id)
    }
  }, [activeSourceId, sources.data])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selectedTrack) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, selectedTrack])

  const tracks = useQuery({
    queryKey: ['discovery-tracks', activeSourceId, statusFilter, search],
    queryFn: () =>
      discovery.listTracks(activeSourceId!, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: search || undefined,
        size: 500,
      }),
    enabled: !!activeSourceId,
  })

  const addSource = useMutation({
    mutationFn: (url: string) => discovery.createSource(url),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['discovery-sources'] })
      setActiveSourceId(created.id)
    },
  })

  const handleAddSource = async () => {
    const url = window.prompt(
      'Paste a YouTube channel URL (or @handle) or a playlist URL:\n\n' +
        'e.g. https://www.youtube.com/@RokTorkar\n' +
        'or   https://www.youtube.com/playlist?list=PLxxxxxxxxx',
    )
    if (!url?.trim()) return
    try {
      await addSource.mutateAsync(url.trim())
    } catch (e) {
      alert((e as Error).message)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[var(--color-bg)]">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Crate Digger</h1>
          <p className="text-xs text-[var(--color-muted)]">
            Import metadata from curated YouTube channels. Discovery + audition only — no downloads.
          </p>
        </div>
        <button onClick={onClose} className="text-[var(--color-muted)] hover:text-white" aria-label="Close">
          ×
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <SourceSidebar
          sources={sources.data ?? []}
          activeId={activeSourceId}
          onSelect={setActiveSourceId}
          onAdd={handleAddSource}
          adding={addSource.isPending}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-[var(--color-border)]">
          {activeSourceId ? (
            <>
              <FilterBar
                search={search}
                onSearch={setSearch}
                statusFilter={statusFilter}
                onStatusFilter={setStatusFilter}
                total={tracks.data?.total ?? 0}
              />
              <div className="min-h-0 flex-1 overflow-y-auto">
                <DiscoveredTrackList
                  tracks={tracks.data?.items ?? []}
                  loading={tracks.isLoading}
                  onSelect={setSelectedTrack}
                />
              </div>
            </>
          ) : (
            <p className="p-8 text-sm text-[var(--color-muted)]">
              Add a YouTube channel or playlist on the left to start digging.
            </p>
          )}
        </div>
      </div>

      {selectedTrack && (
        <DiscoveredTrackDetail
          trackId={selectedTrack.id}
          onClose={() => setSelectedTrack(null)}
        />
      )}
    </div>
  )
}

function SourceSidebar({
  sources,
  activeId,
  onSelect,
  onAdd,
  adding,
}: {
  sources: DiscoverySource[]
  activeId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  adding: boolean
}) {
  return (
    <aside className="flex w-[20rem] shrink-0 flex-col">
      <div className="border-b border-[var(--color-border)] p-2">
        <button
          onClick={onAdd}
          disabled={adding}
          className="w-full rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {adding ? 'Adding…' : '+ Add YouTube source'}
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {sources.length === 0 && (
          <p className="p-4 text-sm text-[var(--color-muted)]">No sources yet.</p>
        )}
        {sources.map((s) => (
          <SourceRow
            key={s.id}
            source={s}
            active={s.id === activeId}
            onSelect={() => onSelect(s.id)}
          />
        ))}
      </ul>
    </aside>
  )
}

function SourceRow({
  source,
  active,
  onSelect,
}: {
  source: DiscoverySource
  active: boolean
  onSelect: () => void
}) {
  const qc = useQueryClient()
  const [scanProgress, setScanProgress] = useState<{ status: string; totalImported: number; newItems: number } | null>(null)

  const startScan = useMutation({
    mutationFn: () => discovery.scanSource(source.id),
    onSuccess: () => {
      const teardown = subscribeToDiscoveryScan(source.id, {
        onProgress: (p) => setScanProgress({ status: p.status, totalImported: p.totalImported, newItems: p.newItems }),
        onComplete: (p) => {
          setScanProgress(null)
          if (p.status === 'Completed') {
            qc.invalidateQueries({ queryKey: ['discovery-sources'] })
            qc.invalidateQueries({ queryKey: ['discovery-tracks', source.id] })
          }
          teardown()
        },
      })
    },
  })

  const remove = useMutation({
    mutationFn: () => discovery.deleteSource(source.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discovery-sources'] }),
  })

  return (
    <li
      className={[
        'group cursor-pointer border-b border-[var(--color-border)]/40 px-4 py-2.5 text-sm hover:bg-white/5',
        active ? 'bg-[var(--color-accent)]/10' : '',
      ].join(' ')}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-medium">{source.name}</span>
        <span className="text-[10px] text-[var(--color-muted)]">
          {source.sourceType === 'YouTubeChannel' ? 'Ch' : 'PL'}
        </span>
      </div>
      <div className="mt-0.5 text-xs text-[var(--color-muted)]">
        {scanProgress
          ? `${scanProgress.status === 'Running' ? 'Scanning' : scanProgress.status} · ${scanProgress.newItems} new`
          : `${source.importedCount} imported${source.lastScannedAt ? ` · ${new Date(source.lastScannedAt).toLocaleDateString()}` : ''}`}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation()
            startScan.mutate()
          }}
          disabled={startScan.isPending}
          className="text-[var(--color-accent)] hover:underline disabled:opacity-40"
        >
          {startScan.isPending ? 'queued…' : 'rescan'}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (window.confirm(`Remove "${source.name}"?`)) remove.mutate()
          }}
          className="ml-auto text-red-400 hover:underline"
        >
          delete
        </button>
      </div>
    </li>
  )
}

function FilterBar({
  search,
  onSearch,
  statusFilter,
  onStatusFilter,
  total,
}: {
  search: string
  onSearch: (s: string) => void
  statusFilter: DiscoveryStatus | 'all'
  onStatusFilter: (s: DiscoveryStatus | 'all') => void
  total: number
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-4 py-2">
      <input
        type="text"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search title or artist"
        className="min-w-[14rem] flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
      />
      <div className="flex flex-wrap gap-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => onStatusFilter(f.value)}
            className={[
              'rounded-full px-2.5 py-1 text-[11px]',
              statusFilter === f.value
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-white',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>
      <span className="ml-auto text-xs text-[var(--color-muted)]">
        {total.toLocaleString()} tracks
      </span>
    </div>
  )
}
