import { ChevronRight, FolderSearch, Settings2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { bridgeAvailable } from '../../bridge'
import { PlanSwitcher } from '../mixchain/PlanSwitcher'
import { SoulseekStatusIndicator } from '../soulseek/SoulseekStatusIndicator'
import { useCurrentPage } from '../../state/currentPage'
import { useActivePlaylist } from '../../state/activePlaylist'
import { playlists } from '../../api/playlists'
import { Button, IconButton } from '../../components/ui/Button'

interface Props {
  scanActive: boolean
  onScan: () => void
  onOpenSettings: () => void
}

/// Slim top bar — section navigation moved to `AppSidebar`. This bar now only
/// owns global actions (Plan switcher, Soulseek transfer indicator, Scan, Settings).
/// Kept around as its own component partly for the global-search slot we'll add later.
export function AppHeader({ scanActive, onScan, onOpenSettings }: Props) {
  const page = useCurrentPage((s) => s.page)
  const recordingPage = page === 'recordings'
  const activePlaylistId = useActivePlaylist((s) => s.activePlaylistId)
  const list = useQuery({
    queryKey: ['playlists'],
    queryFn: () => playlists.list(),
    staleTime: 30_000,
  })
  const activePlaylist =
    page === 'library' ? list.data?.find((p) => p.id === activePlaylistId) : null
  const label =
    activePlaylist?.name ??
    {
      library: 'Library',
      'mix-plans': 'Mix Plans',
      recordings: 'Mixes',
      discover: 'Discover',
      'crate-digger': 'Crate Digger',
      wanted: 'Wanted',
      soulseek: 'Soulseek',
    }[page]
  return (
    <header className="app-header shrink-0">
      <div className="app-breadcrumb" aria-label="Current workspace">
        <span>
          {activePlaylist
            ? 'Playlists'
            : ['discover', 'crate-digger', 'wanted', 'soulseek'].includes(page)
              ? 'Find music'
              : 'Workspace'}
        </span>
        <ChevronRight size={14} aria-hidden="true" />
        <strong data-ui-tooltip={label}>{label}</strong>
      </div>
      <div className="app-global-actions">
        <SoulseekStatusIndicator />
        {!recordingPage && page !== 'mix-plans' && <PlanSwitcher />}
        {!recordingPage && (
          <Button
            onClick={onScan}
            disabled={!bridgeAvailable() || scanActive}
            aria-label={scanActive ? 'Scanning folder' : 'Scan folder'}
            tooltip={
              bridgeAvailable()
                ? scanActive
                  ? 'A folder scan is already running.'
                  : 'Choose a music folder to scan.'
                : 'Folder selection requires the WISP desktop app.'
            }
          >
            <FolderSearch aria-hidden="true" />
            <span className="scan-label">{scanActive ? 'Scanning…' : 'Scan folder'}</span>
          </Button>
        )}
        <IconButton onClick={onOpenSettings} label="Settings" variant="quiet">
          <Settings2 aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  )
}
