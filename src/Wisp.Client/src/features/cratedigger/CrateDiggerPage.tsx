import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { discovery } from '../../api/discovery'
import { alertDialog, confirmDialog, promptDialog } from '../../components/dialog'
import type {
  DiscoveredTrack,
  DiscoverySource,
  DiscoveryScanProgress,
  DiscoveryStatus,
} from '../../api/types'
import { DiscoveredTrackList } from './DiscoveredTrackList'
import { DiscoveredTrackDetail } from './DiscoveredTrackDetail'
import { useDiscoveryScans } from './useDiscoveryScans'

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

/// Crate Digger as a routed peer page — no `fixed inset-0`, no onClose.
/// Top-nav handles back-out; the only Esc handler that remains is inside
/// the per-track detail modal, which closes that modal not the page.
export function CrateDiggerPage() {
  const qc = useQueryClient()
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<DiscoveryStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedTrack, setSelectedTrack] = useState<DiscoveredTrack | null>(null)
  const scans = useDiscoveryScans()

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
      // The backend auto-queues an initial scan on create — start tracking its progress
      // immediately so the user sees a spinner instead of an empty source row.
      scans.trackScan(created.id)
    },
  })

  const handleAddSource = async () => {
    const url = await promptDialog({
      title: 'Add discovery source',
      message: 'Paste a YouTube channel URL (or @handle) or a playlist URL.\n\nExamples:\n  https://www.youtube.com/@RokTorkar\n  https://www.youtube.com/playlist?list=PL…',
      placeholder: 'https://www.youtube.com/...',
      confirmLabel: 'Add',
      maxLength: 1000,
    })
    if (!url) return
    try {
      await addSource.mutateAsync(url)
    } catch (e) {
      await alertDialog({
        title: 'Could not add source',
        message: (e as Error).message,
        tone: 'error',
      })
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Crate Digger</h1>
          <p className="text-xs text-[var(--color-muted)]">
            Import metadata from curated YouTube channels. Discovery + audition only — no downloads.
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <SourceSidebar
          sources={sources.data ?? []}
          activeId={activeSourceId}
          progress={scans.progress}
          onSelect={setActiveSourceId}
          onAdd={handleAddSource}
          onTrackScan={scans.trackScan}
          adding={addSource.isPending}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-[var(--color-border)]">
          {activeSourceId ? (
            <>
              {activeSourceId in scans.progress && (
                <ScanBanner progress={scans.progress[activeSourceId]} />
              )}
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
  progress,
  onSelect,
  onAdd,
  onTrackScan,
  adding,
}: {
  sources: DiscoverySource[]
  activeId: string | null
  progress: Record<string, DiscoveryScanProgress>
  onSelect: (id: string) => void
  onAdd: () => void
  onTrackScan: (id: string) => void
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
            scanProgress={progress[s.id] ?? null}
            onSelect={() => onSelect(s.id)}
            onTrackScan={onTrackScan}
          />
        ))}
      </ul>
    </aside>
  )
}

function SourceRow({
  source,
  active,
  scanProgress,
  onSelect,
  onTrackScan,
}: {
  source: DiscoverySource
  active: boolean
  scanProgress: DiscoveryScanProgress | null
  onSelect: () => void
  onTrackScan: (id: string) => void
}) {
  const qc = useQueryClient()

  const startScan = useMutation({
    mutationFn: () => discovery.scanSource(source.id),
    onSuccess: () => onTrackScan(source.id),
  })

  const remove = useMutation({
    mutationFn: () => discovery.deleteSource(source.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discovery-sources'] }),
  })

  const isScanning = scanProgress !== null

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
        <div className="flex items-center gap-1.5">
          {isScanning && <Spinner />}
          <span className="text-[10px] text-[var(--color-muted)]">
            {source.sourceType === 'YouTubeChannel' ? 'Ch' : 'PL'}
          </span>
        </div>
      </div>
      <div className="mt-0.5 text-xs text-[var(--color-muted)]">
        {isScanning
          ? scanProgress.status === 'Pending'
            ? 'Queued…'
            : scanProgress.status === 'Running'
              ? scanProgress.totalImported > 0
                ? `Scanning · ${scanProgress.newItems} new of ${scanProgress.totalImported}`
                : 'Scanning YouTube…'
              : scanProgress.status
          : `${source.importedCount} imported${source.lastScannedAt ? ` · ${new Date(source.lastScannedAt).toLocaleDateString()}` : ''}`}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[10px] opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={(e) => {
            e.stopPropagation()
            startScan.mutate()
          }}
          disabled={startScan.isPending || isScanning}
          className="text-[var(--color-accent)] hover:underline disabled:opacity-40"
        >
          {startScan.isPending || isScanning ? 'scanning…' : 'rescan'}
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation()
            const ok = await confirmDialog({
              title: `Remove "${source.name}"?`,
              message: 'The source and any tracks it discovered will be removed from Crate Digger. The original YouTube content stays untouched.',
              danger: true,
              confirmLabel: 'Remove',
            })
            if (ok) remove.mutate()
          }}
          className="ml-auto text-red-400 hover:underline"
        >
          delete
        </button>
      </div>
    </li>
  )
}

function ScanBanner({ progress }: { progress: DiscoveryScanProgress }) {
  return (
    <div className="flex items-center gap-3 border-b border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-4 py-2.5 text-sm">
      <Spinner />
      <span className="flex-1">
        {progress.status === 'Pending' && 'Scan queued…'}
        {progress.status === 'Running' && (
          progress.totalImported > 0
            ? `Importing — ${progress.newItems} new of ${progress.totalImported} so far`
            : 'Fetching from YouTube…'
        )}
        {progress.status === 'Failed' && (
          <span className="text-red-300">Scan failed{progress.error ? `: ${progress.error}` : ''}</span>
        )}
      </span>
      <span className="text-xs text-[var(--color-muted)]">
        Tracks will appear automatically when done.
      </span>
    </div>
  )
}

function Spinner() {
  return (
    <span
      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--color-accent)] border-t-transparent"
      aria-hidden
    />
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
