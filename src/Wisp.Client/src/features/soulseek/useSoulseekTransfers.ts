import { useEffect, useRef } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet } from '../../api/client'
import { library } from '../../api/library'
import { soulseek } from '../../api/soulseek'
import { useSoulseekStatus } from '../../state/soulseekStatus'

const POLL_INTERVAL_MS = 2_000

interface SoulseekConfigStatus {
  isConfigured: boolean
}

/// Single source of truth for the active Soulseek transfer list. Any component
/// that wants to render progress/state subscribes to this hook — they all share
/// the same TanStack Query cache and the same App-level polling cadence.
///
/// Polling rules:
///   - Only enabled when slskd is configured AND someone has flipped
///     `useSoulseekStatus().pollingActive` (e.g. by queueing a download).
///   - Auto-stops when the list contains no in-flight transfers.
///   - Follows the import scan to completion, then refreshes the library.
export function useSoulseekTransfers() {
  const qc = useQueryClient()
  const pollingActive = useSoulseekStatus((s) => s.pollingActive)
  const stopPolling = useSoulseekStatus((s) => s.stopPolling)
  const refreshedScans = useRef(new Set<string>())

  const status = useQuery({
    queryKey: ['soulseek-status'],
    queryFn: () => apiGet<SoulseekConfigStatus>('/api/settings/soulseek'),
    staleTime: 60_000,
  })
  const slskdConfigured = status.data?.isConfigured ?? false

  const transfers = useQuery({
    queryKey: ['soulseek-downloads'],
    queryFn: () => soulseek.listDownloads(),
    enabled: slskdConfigured && pollingActive,
    refetchInterval: (q) => {
      const data = q.state.data
      if (!data) return POLL_INTERVAL_MS
      const stillActive = data.some((t) => !t.state.includes('Completed'))
      if (!stillActive) {
        // Defer the state flip so we don't mutate during a TanStack callback.
        setTimeout(stopPolling, 0)
        return false
      }
      return POLL_INTERVAL_MS
    },
    retry: false,
  })

  const scanIds = [...new Set((transfers.data ?? []).flatMap(t => t.importScanId ? [t.importScanId] : []))]
  const importScans = useQueries({ queries: scanIds.map(id => ({
    queryKey: ['soulseek-import-scan', id],
    queryFn: () => library.getScan(id),
    staleTime: Infinity,
    refetchInterval: (q: { state: { data?: { status: string } } }) =>
      q.state.data && ['Completed', 'Failed', 'Cancelled'].includes(q.state.data.status) ? false : POLL_INTERVAL_MS,
    retry: 1,
  })) })

  // Follow actual scan completion, independently of transfer polling. Fixed
  // delays missed slow scans and could be cancelled by the next transfer poll.
  useEffect(() => {
    for (const scan of importScans) {
      const job = scan.data
      if (!job || !['Completed', 'Failed', 'Cancelled'].includes(job.status) || refreshedScans.current.has(job.id)) continue
      refreshedScans.current.add(job.id)
      void qc.invalidateQueries({ queryKey: ['tracks'] })
    }
  }, [importScans, qc])

  return {
    slskdConfigured,
    transfers: transfers.data ?? [],
    isLoading: transfers.isLoading,
    error: transfers.error,
  }
}
