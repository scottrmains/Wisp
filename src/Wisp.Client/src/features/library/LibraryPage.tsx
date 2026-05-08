import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { tracks } from '../../api/library'
import type { AuditEntry, Track, TrackQuery } from '../../api/types'
import { bridge, bridgeAvailable } from '../../bridge'
import { useActivePlan } from '../../state/activePlan'
import { CleanupModal } from '../cleanup/CleanupModal'
import { UndoToast } from '../cleanup/UndoToast'
import { CrateDiggerPage } from '../cratedigger/CrateDiggerPage'
import { ChainDock } from '../mixchain/ChainDock'
import { PlanSwitcher } from '../mixchain/PlanSwitcher'
import { useMixPlan } from '../mixchain/useMixPlans'
import { RediscoverScreen } from '../rediscover/RediscoverScreen'
import { SettingsPanel } from '../settings/SettingsPanel'
import { LibraryFilters } from './LibraryFilters'
import { LibraryTable } from './LibraryTable'
import { RecommendationPanel } from './RecommendationPanel'
import { ScanToast } from './ScanToast'
import { useScan } from './useScan'

export function LibraryPage() {
  const [query, setQuery] = useState<TrackQuery>({ page: 1, size: 500 })
  const [selected, setSelected] = useState<Track | null>(null)
  const [chainCollapsed, setChainCollapsed] = useState(false)
  const [cleanupTarget, setCleanupTarget] = useState<Track | null>(null)
  const [recentAudit, setRecentAudit] = useState<AuditEntry | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [rediscoverOpen, setRediscoverOpen] = useState(false)
  const [crateDiggerOpen, setCrateDiggerOpen] = useState(false)
  const { activePlanId } = useActivePlan()
  const activePlan = useMixPlan(activePlanId)
  const scan = useScan()

  const addToActivePlan = (trackId: string) => {
    if (!activePlanId) return
    activePlan.addTrack.mutate({ trackId })
  }

  const tracksQuery = useQuery({
    queryKey: ['tracks', query],
    queryFn: () => tracks.list(query),
  })

  const total = tracksQuery.data?.total ?? 0
  const items = tracksQuery.data?.items ?? []

  const pickAndScan = async () => {
    if (!bridgeAvailable()) return
    const result = await bridge.pickFolder()
    if (result.path) await scan.start(result.path)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Wisp</h1>
          <p className="text-xs text-[var(--color-muted)]">Library</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setRediscoverOpen(true)}
            className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] hover:text-white"
            title="What did your favourite artists release recently?"
          >
            Rediscover
          </button>
          <button
            onClick={() => setCrateDiggerOpen(true)}
            className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] hover:text-white"
            title="Import tunes from curated YouTube channels"
          >
            Crate Digger
          </button>
          <PlanSwitcher />
          <button
            onClick={pickAndScan}
            disabled={!bridgeAvailable() || scan.active}
            className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            title={bridgeAvailable() ? 'Pick a folder and scan' : 'Folder picker only works inside Photino'}
          >
            {scan.active ? 'Scanning…' : 'Scan folder'}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-muted)] hover:text-white"
            aria-label="Settings"
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      {total === 0 && !tracksQuery.isLoading ? (
        <EmptyState onPick={pickAndScan} canPick={bridgeAvailable()} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <LibraryFilters query={query} onChange={setQuery} total={total} />
            <div className="min-h-0 flex-1">
              <LibraryTable
                tracks={items}
                loading={tracksQuery.isLoading}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                onAddToChain={activePlanId ? addToActivePlan : undefined}
                onCleanup={setCleanupTarget}
              />
            </div>
          </div>
          {selected && (
            <RecommendationPanel
              seed={selected}
              onClose={() => setSelected(null)}
              onAddToChain={activePlanId ? addToActivePlan : undefined}
            />
          )}
        </div>
      )}

      {activePlanId && (
        <ChainDock
          planId={activePlanId}
          collapsed={chainCollapsed}
          onToggle={() => setChainCollapsed((c) => !c)}
        />
      )}

      <ScanToast
        progress={scan.progress}
        error={scan.error}
        active={scan.active}
        onDismiss={scan.dismiss}
      />

      {cleanupTarget && (
        <CleanupModal
          trackId={cleanupTarget.id}
          trackLabel={`${cleanupTarget.artist ?? 'Unknown'} — ${cleanupTarget.title ?? cleanupTarget.fileName}`}
          onClose={() => setCleanupTarget(null)}
          onApplied={(audit) => setRecentAudit(audit)}
        />
      )}

      {recentAudit && (
        <UndoToast audit={recentAudit} onDismiss={() => setRecentAudit(null)} />
      )}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {rediscoverOpen && <RediscoverScreen onClose={() => setRediscoverOpen(false)} />}
      {crateDiggerOpen && <CrateDiggerPage onClose={() => setCrateDiggerOpen(false)} />}
    </div>
  )
}

function EmptyState({ onPick, canPick }: { onPick: () => void; canPick: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-3xl font-semibold tracking-tight">Your library is empty</div>
      <p className="max-w-md text-sm text-[var(--color-muted)]">
        Pick a folder of analysed tracks to start. Wisp reads BPM, key and energy from
        Mixed in Key tags — no audio analysis required.
      </p>
      <button
        onClick={onPick}
        disabled={!canPick}
        className="rounded-md bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        Pick a folder
      </button>
      {!canPick && (
        <p className="text-xs text-[var(--color-muted)]">
          The folder picker only works in the desktop shell — launch via Wisp.exe.
        </p>
      )}
    </div>
  )
}
