import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FolderOpen, RefreshCw, Search, Settings, Upload } from 'lucide-react'
import { apiGet } from '../../api/client'
import { soulseek } from '../../api/soulseek'
import { bridge, bridgeAvailable } from '../../bridge'
import { SoulseekDialog } from './SoulseekDialog'
import { SoulseekSharingPanel } from './SoulseekSharingPanel'
import { SoulseekTransferList } from './SoulseekTransferList'
import { useSoulseekTransfers } from './useSoulseekTransfers'
import { transferState } from './transferState'
import { useSearchSession } from './searchSession'
import { SectionTabs } from '../../components/ui/SectionTabs'
import { Button } from '../../components/ui/Button'
import './soulseek.css'

export function SoulseekPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const tab = useSearchSession((s) => s.tab)
  const setTab = useSearchSession((s) => s.setTab)
  const [folderError, setFolderError] = useState<string | null>(null)
  const qc = useQueryClient()
  const { transfers, slskdConfigured, error, refresh } = useSoulseekTransfers()
  const connection = useQuery({
    queryKey: ['soulseek-connection'],
    queryFn: soulseek.connection,
    refetchInterval: 5_000,
    retry: false,
  })
  const destination = useQuery({
    queryKey: ['soulseek-download-folder'],
    enabled: slskdConfigured,
    queryFn: () =>
      apiGet<{
        effectiveDownloadFolder: string | null
        restartRequired: boolean
        nextDownloadFolder: string
      }>('/api/settings/soulseek/download-folder'),
    retry: false,
  })
  const reconnect = useMutation({
    mutationFn: soulseek.reconnect,
    onSettled: () => qc.invalidateQueries({ queryKey: ['soulseek-connection'] }),
  })
  const online = connection.data?.isConnected && connection.data?.isLoggedIn
  const active = transfers.filter((t) => !transferState(t.state).finished).length
  const status = connection.isLoading
    ? 'Checking connection…'
    : online
      ? 'Connected'
      : connection.data?.isTransitioning
        ? 'Connecting…'
        : connection.data?.daemonAvailable
          ? 'Not logged in'
          : 'Unavailable'

  const openFolder = async () => {
    setFolderError(null)
    try {
      if (destination.data?.effectiveDownloadFolder)
        await bridge.openInExplorer(destination.data.effectiveDownloadFolder)
    } catch (e) {
      setFolderError((e as Error).message)
    }
  }

  return (
    <div className="feature-workspace soulseek-workspace">
      <header className="workspace-heading flex-wrap">
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <div>
            <h1>Soulseek</h1>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Find music. Follow your downloads. Share on your terms.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span role="status" className="inline-flex items-center gap-2">
              <span
                aria-hidden
                className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-amber-400'}`}
              />
              {status}
              {connection.data?.username && (
                <span className="text-[var(--color-muted)]">· {connection.data.username}</span>
              )}
            </span>
            {!online && connection.data?.daemonAvailable && (
              <Button small onClick={() => reconnect.mutate()} disabled={reconnect.isPending}>
                <RefreshCw />
                {reconnect.isPending ? 'Reconnecting…' : 'Reconnect'}
              </Button>
            )}
            {connection.isError && (
              <Button small onClick={() => void connection.refetch()}>
                Retry connection
              </Button>
            )}
            <Button small onClick={onOpenSettings}>
              <Settings />
              Settings
            </Button>
          </div>
        </div>
        {!online && !connection.isLoading && (
          <p role="status" className="mt-3 text-xs text-amber-200">
            {connection.error?.message ??
              connection.data?.message ??
              'Set up your Soulseek account in Settings. Your saved downloads remain available when the connection returns.'}
          </p>
        )}
        {reconnect.error && (
          <p role="alert" className="mt-2 text-xs text-red-300">
            {reconnect.error.message}
          </p>
        )}
      </header>
      <div className="shrink-0 px-5 lg:px-7">
        <SectionTabs
          label="Soulseek sections"
          active={tab}
          items={[
            { id: 'search', label: 'Search', icon: <Search aria-hidden="true" /> },
            {
              id: 'downloads',
              label: `Downloads${active ? ` (${active})` : ''}`,
              icon: <Download aria-hidden="true" />,
            },
            { id: 'sharing', label: 'Sharing', icon: <Upload aria-hidden="true" /> },
          ]}
          onSelect={(id) => {
            setTab(id)
            if (id === 'downloads') void refresh()
          }}
        />
      </div>
      <div className={tab === 'search' ? 'min-h-0 flex-1' : 'hidden'}>
        <SoulseekDialog
          embedded
          initialArtist={null}
          initialTitle={null}
          onClose={() => {}}
          networkReady={!!online}
        />
      </div>
      {tab === 'downloads' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-5 py-3 text-xs">
            <div className="min-w-0 flex-1">
              <span className="text-[var(--color-muted)]">Downloading to </span>
              <span className="break-all">
                {destination.data?.effectiveDownloadFolder ?? 'Folder unavailable'}
              </span>
              {destination.data?.restartRequired && (
                <p className="mt-1 text-amber-200">
                  New destination saved. Restart WISP to use {destination.data.nextDownloadFolder}.
                </p>
              )}
            </div>
            <Button small onClick={() => void refresh()}>
              <RefreshCw />
              Refresh
            </Button>
            <Button
              small
              onClick={() => void openFolder()}
              disabled={!bridgeAvailable() || !destination.data?.effectiveDownloadFolder}
              tooltip={!bridgeAvailable() ? 'Open folder requires the WISP desktop app' : undefined}
            >
              <FolderOpen />
              Open folder
            </Button>
          </div>
          {(folderError || destination.error) && (
            <p role="alert" className="px-5 py-2 text-xs text-red-300">
              {folderError ?? destination.error?.message}
            </p>
          )}
          <div className="min-h-0 flex-1">
            <SoulseekTransferList full transfers={transfers} error={error} />
          </div>
        </div>
      )}
      {tab === 'sharing' && <SoulseekSharingPanel />}
    </div>
  )
}
