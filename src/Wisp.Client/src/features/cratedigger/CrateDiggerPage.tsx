import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { discovery } from '../../api/discovery'
import { alertDialog, confirmDialog, promptDialog } from '../../components/dialog'
import type {
  DiscoveredTrack,
  DiscoverySource,
  DiscoveryScanProgress,
  DiscoveryStatus,
  DiscoverySort,
} from '../../api/types'
import { DiscoveredTrackList } from './DiscoveredTrackList'
import { DiscoveredTrackDetail } from './DiscoveredTrackDetail'
import { useDiscoveryScans } from './useDiscoveryScans'
import { useUiPrefs } from '../../state/uiPrefs'
import { Button, IconButton } from '../../components/ui/Button'
import { StatusMessage } from '../../components/ui/StatusMessage'
import { WorkspaceNavigation, NavigationToggle } from '../../components/ui/WorkspaceNavigation'
import { Plus, Search, RefreshCw, Info, Trash2 } from 'lucide-react'

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
/// Per-track inspection is non-modal; Escape closes details, not the page.
export function CrateDiggerPage() {
  const qc = useQueryClient()
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<DiscoveryStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const sort = useUiPrefs((s) => s.discoverySort)
  const setSort = useUiPrefs((s) => s.setDiscoverySort)
  const [selectedTrack, setSelectedTrack] = useState<DiscoveredTrack | null>(null)
  const [inspectionDirty, setInspectionDirty] = useState(false)
  const scans = useDiscoveryScans()

  const sources = useQuery({
    queryKey: ['discovery-sources'],
    queryFn: () => discovery.listSources(),
  })

  // Auto-select first source on load.
  useEffect(() => {
    if (sources.data && !sources.data.some((s) => s.id === activeSourceId)) {
      setActiveSourceId(sources.data[0]?.id ?? null)
      setPage(1)
      setSelectedTrack(null)
      setInspectionDirty(false)
    }
  }, [activeSourceId, sources.data])

  const tracks = useQuery({
    queryKey: ['discovery-tracks', activeSourceId, statusFilter, search, sort, page],
    queryFn: () =>
      discovery.listTracks(activeSourceId!, {
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: search || undefined,
        sort,
        page,
        size: 500,
      }),
    enabled: !!activeSourceId,
  })

  const rescan = useMutation({
    mutationFn: (sourceId: string) => discovery.scanSource(sourceId),
    onSuccess: (_, sourceId) => scans.trackScan(sourceId),
  })

  const addSource = useMutation({
    mutationFn: (url: string) => discovery.createSource(url),
    onSuccess: (created) => {
      // Keep the newly selected source in the cached navigator immediately.
      // Otherwise the missing-source effect can reset selection before refetch.
      qc.setQueryData<DiscoverySource[]>(['discovery-sources'], (previous) =>
        previous?.some((source) => source.id === created.id)
          ? previous
          : [...(previous ?? []), created],
      )
      qc.invalidateQueries({ queryKey: ['discovery-sources'] })
      setActiveSourceId(created.id)
      setPage(1)
      setSelectedTrack(null)
      setInspectionDirty(false)
      // The backend auto-queues an initial scan on create — start tracking its progress
      // immediately so the user sees a spinner instead of an empty source row.
      scans.trackScan(created.id)
    },
  })

  const handleAddSource = async () => {
    if (!(await canLeaveInspector())) return
    const url = await promptDialog({
      title: 'Add discovery source',
      message:
        'Paste a YouTube channel URL (or @handle) or a playlist URL.\n\nExamples:\n  https://www.youtube.com/@RokTorkar\n  https://www.youtube.com/playlist?list=PL…',
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

  const canLeaveInspector = async () =>
    !inspectionDirty ||
    (await confirmDialog({
      title: 'Discard metadata correction?',
      message: 'Save the correction first to keep it, or discard the unsaved fields.',
      confirmLabel: 'Discard correction',
      danger: true,
    }))
  const closeInspector = async () => {
    if (!(await canLeaveInspector())) return
    if (selectedTrack)
      document
        .querySelector<HTMLButtonElement>(
          `[data-discovery-track="${CSS.escape(selectedTrack.id)}"] button`,
        )
        ?.focus()
    setSelectedTrack(null)
    setInspectionDirty(false)
  }
  const selectTrack = async (track: DiscoveredTrack) => {
    if (track.id === selectedTrack?.id || !(await canLeaveInspector())) return
    setSelectedTrack(track)
    setInspectionDirty(false)
  }
  const activeSource = sources.data?.find((s) => s.id === activeSourceId)

  return (
    <div className="feature-workspace crate-workspace">
      <header className="workspace-heading">
        <NavigationToggle navigation="sources" label="sources" />
        <div className="min-w-0 flex-1">
          <h1>Crate Digger</h1>
          <p>Dig through curated YouTube channels and playlists.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => void handleAddSource()}
          disabled={addSource.isPending}
        >
          <Plus /> Add YouTube source
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <WorkspaceNavigation navigation="sources" label="Sources">
          {sources.isError ? (
            <StatusMessage tone="error">
              Could not load sources: {sources.error.message}.{' '}
              <Button small onClick={() => void sources.refetch()}>
                Retry sources
              </Button>
            </StatusMessage>
          ) : sources.isLoading ? (
            <p className="workspace-empty" role="status">
              Loading sources…
            </p>
          ) : (
            <SourceSidebar
              sources={sources.data ?? []}
              activeId={activeSourceId}
              progress={scans.progress}
              onSelect={(id) => {
                void (async () => {
                  if (!(await canLeaveInspector())) return
                  setActiveSourceId(id)
                  setPage(1)
                  setSelectedTrack(null)
                  setInspectionDirty(false)
                })()
              }}
              onTrackScan={scans.trackScan}
            />
          )}
        </WorkspaceNavigation>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-[var(--color-border)]">
          {activeSourceId ? (
            <>
              <div className="workspace-source-heading">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate" title={activeSource?.name}>
                    {activeSource?.name ?? 'Source'}
                  </h2>
                  <p data-ui-tooltip="Sources import YouTube metadata for discovery and audition. They do not download audio.">
                    {activeSource?.sourceType === 'YouTubeChannel'
                      ? 'YouTube channel'
                      : 'YouTube playlist'}{' '}
                    · {(tracks.data?.total ?? 0).toLocaleString()} discoveries
                  </p>
                </div>
                <Button
                  small
                  onClick={() => rescan.mutate(activeSourceId)}
                  disabled={rescan.isPending || activeSourceId in scans.progress}
                >
                  <RefreshCw />
                  {rescan.isPending
                    ? 'Queuing…'
                    : activeSourceId in scans.progress
                      ? 'Scanning…'
                      : 'Rescan source'}
                </Button>
                <IconButton
                  small
                  variant="quiet"
                  label="About upload dates"
                  tooltip={
                    (tracks.data?.undatedCount ?? 0) > 0
                      ? `${tracks.data!.undatedCount.toLocaleString()} videos have no upload date; undated videos sort last. Rescan older imports to fetch dates. Upload date is not release year.`
                      : 'Upload date is when the video was posted to YouTube, not the track’s release year.'
                  }
                >
                  <Info />
                </IconButton>
              </div>
              {activeSourceId in scans.progress && (
                <ScanBanner
                  progress={scans.progress[activeSourceId]}
                  reconnecting={scans.connectionErrors[activeSourceId]}
                />
              )}
              {!(activeSourceId in scans.progress) && scans.results[activeSourceId] && (
                <ScanBanner
                  progress={scans.results[activeSourceId]}
                  onDismiss={() => scans.dismissResult(activeSourceId)}
                />
              )}
              <FilterBar
                search={search}
                onSearch={(value) => {
                  setSearch(value)
                  setPage(1)
                }}
                statusFilter={statusFilter}
                onStatusFilter={(value) => {
                  setStatusFilter(value)
                  setPage(1)
                }}
                sort={sort}
                onSort={(value) => {
                  setSort(value)
                  setPage(1)
                }}
                total={tracks.data?.total ?? 0}
              />
              {rescan.isError && (
                <StatusMessage tone="error">
                  Could not start scan: {rescan.error.message}. Try Rescan source again.
                </StatusMessage>
              )}
              {tracks.isError && (
                <StatusMessage tone="error">
                  Could not load discoveries: {tracks.error.message}.{' '}
                  <Button small onClick={() => void tracks.refetch()}>
                    Retry discoveries
                  </Button>
                </StatusMessage>
              )}
              <div
                key={`${activeSourceId}:${sort}:${page}:${statusFilter}:${search}`}
                className="min-h-0 flex-1 overflow-y-auto"
              >
                {!tracks.isError && (
                  <DiscoveredTrackList
                    tracks={tracks.data?.items ?? []}
                    loading={tracks.isLoading}
                    selectedId={selectedTrack?.id}
                    onSelect={(track) => void selectTrack(track)}
                  />
                )}
              </div>
              {(tracks.data?.total ?? 0) > 500 && (
                <nav
                  aria-label="Discovery pages"
                  className="flex items-center justify-end gap-3 border-t border-[var(--color-border)] px-4 py-2 text-xs"
                >
                  <button
                    disabled={page === 1 || tracks.isFetching}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span>
                    Page {page} of {Math.ceil((tracks.data?.total ?? 0) / 500)}
                  </span>
                  <button
                    disabled={page * 500 >= (tracks.data?.total ?? 0) || tracks.isFetching}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded border border-[var(--color-border)] px-3 py-1 disabled:opacity-40"
                  >
                    Next
                  </button>
                </nav>
              )}
            </>
          ) : (
            <p className="p-8 text-sm text-[var(--color-muted)]">
              Add a YouTube channel or playlist on the left to start digging.
            </p>
          )}
        </div>
        {selectedTrack && (
          <DiscoveredTrackDetail
            key={selectedTrack.id}
            trackId={selectedTrack.id}
            onDirtyChange={setInspectionDirty}
            onClose={() => void closeInspector()}
          />
        )}
      </div>
    </div>
  )
}

function SourceSidebar({
  sources,
  activeId,
  progress,
  onSelect,
  onTrackScan,
}: {
  sources: DiscoverySource[]
  activeId: string | null
  progress: Record<string, DiscoveryScanProgress>
  onSelect: (id: string) => void
  onTrackScan: (id: string) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
    </div>
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
    <li className="workspace-source-row" data-active={active}>
      <button
        className="workspace-nav-choice"
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
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
      </button>
      {startScan.isError && (
        <p role="alert" className="mt-1 text-xs text-red-400">
          Could not start scan: {startScan.error.message}
        </p>
      )}
      {remove.isError && (
        <StatusMessage tone="error">
          Could not remove source: {remove.error.message}. Try Remove again.
        </StatusMessage>
      )}
      <div className="workspace-source-actions">
        <Button
          small
          variant="quiet"
          onClick={(e) => {
            e.stopPropagation()
            startScan.mutate()
          }}
          disabled={startScan.isPending || isScanning}
          className="text-[var(--color-accent)] hover:underline disabled:opacity-40"
        >
          {startScan.isPending || isScanning ? 'scanning…' : 'rescan'}
        </Button>
        <IconButton
          small
          variant="quiet"
          label={`Remove source ${source.name}`}
          disabled={remove.isPending}
          onClick={async (e) => {
            e.stopPropagation()
            const ok = await confirmDialog({
              title: `Remove "${source.name}"?`,
              message:
                'The source and any tracks it discovered will be removed from Crate Digger. The original YouTube content stays untouched.',
              danger: true,
              confirmLabel: 'Remove',
            })
            if (ok) remove.mutate()
          }}
          className="ml-auto text-red-400 hover:underline"
        >
          <Trash2 />
        </IconButton>
      </div>
    </li>
  )
}

function ScanBanner({
  progress,
  onDismiss,
  reconnecting,
}: {
  progress: DiscoveryScanProgress
  onDismiss?: () => void
  reconnecting?: boolean
}) {
  const active = progress.status === 'Pending' || progress.status === 'Running'
  return (
    <div
      role={progress.status === 'Failed' ? 'alert' : 'status'}
      className="flex items-center gap-3 border-b border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-4 py-2.5 text-sm"
    >
      {active && <Spinner />}
      <span className="flex-1">
        {reconnecting && active ? (
          'Reconnecting to scan progress… the scan may still be running.'
        ) : (
          <>
            {progress.status === 'Pending' && 'Scan queued — waiting to start…'}
            {progress.status === 'Running' &&
              (progress.totalImported > 0
                ? `Importing — ${progress.newItems} new of ${progress.totalImported} so far`
                : 'Fetching from YouTube…')}
            {progress.status === 'Failed' && (
              <span className="text-red-300">
                Scan failed{progress.error ? `: ${progress.error}` : ''}
              </span>
            )}
            {progress.status === 'Cancelled' && 'Scan cancelled. Rescan the source to try again.'}
            {progress.status === 'Completed' && (
              <>
                {progress.newItems === 0
                  ? 'No new tracks found.'
                  : `Scan complete — ${progress.newItems} new ${progress.newItems === 1 ? 'track' : 'tracks'} added.`}
                {(progress.updatedDates ?? 0) > 0 &&
                  ` Updated upload dates for ${progress.updatedDates} ${progress.updatedDates === 1 ? 'track' : 'tracks'}.`}
                <span className="mt-0.5 block text-xs text-[var(--color-muted)]">
                  Checked {(progress.checkedItems ?? progress.totalImported).toLocaleString()}{' '}
                  videos
                  {progress.finishedAt &&
                    ` · ${new Date(progress.finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                  .
                </span>
              </>
            )}
          </>
        )}
      </span>
      {active && !reconnecting && (
        <span className="text-xs text-[var(--color-muted)]">
          Tracks will appear automatically when done.
        </span>
      )}
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss scan result"
          className="shrink-0 rounded border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-white/5"
        >
          Dismiss
        </button>
      )}
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
  sort,
  onSort,
  total,
}: {
  search: string
  onSearch: (s: string) => void
  statusFilter: DiscoveryStatus | 'all'
  onStatusFilter: (s: DiscoveryStatus | 'all') => void
  sort: DiscoverySort
  onSort: (sort: DiscoverySort) => void
  total: number
}) {
  const moreActive = !['all', 'New', 'Want', 'AlreadyHave'].includes(statusFilter)
  return (
    <div className="workspace-toolbar">
      <label className="workspace-search">
        <Search size={16} />
        <span className="sr-only">Search discoveries</span>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search title or artist"
          className="min-w-[14rem] flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-1.5 text-sm placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)] focus:outline-none"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
        Sort by
        <select
          aria-label="Sort discoveries"
          value={sort}
          onChange={(e) => onSort(e.target.value as DiscoverySort)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1.5 text-[var(--color-text)] focus:border-[var(--color-accent)] focus:outline-none"
        >
          <option value="-published">YouTube upload · newest first</option>
          <option value="published">YouTube upload · oldest first</option>
          <option value="-imported">Imported into WISP · newest first</option>
          <option value="imported">Imported into WISP · oldest first</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-1">
        {STATUS_FILTERS.slice(0, 4).map((f) => (
          <Button
            small
            variant={statusFilter === f.value ? 'primary' : 'quiet'}
            aria-pressed={statusFilter === f.value}
            key={f.value}
            onClick={() => onStatusFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      <label className="workspace-select">
        <span className="sr-only">More discovery filters</span>
        <select
          aria-label="More discovery filters"
          value={moreActive ? statusFilter : ''}
          onChange={(e) => onStatusFilter((e.target.value || 'all') as DiscoveryStatus | 'all')}
        >
          <option value="">More filters</option>
          {STATUS_FILTERS.slice(4).map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <span className="ml-auto text-xs text-[var(--color-muted)]">
        {total.toLocaleString()} {total === 1 ? 'track' : 'tracks'}
      </span>
    </div>
  )
}
